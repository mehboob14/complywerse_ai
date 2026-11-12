'use client';

// "Waiting for a decision" on the front door, slim (Overview rule R3): the three oldest files and scope requests across every journey as ONE-LINE rows (the title as the link that opens its
// journey with the decision ready, how long it has waited as a pill whose WORD says so, and the action word), the true count in the header and "See all N" at its end. The platform assigns
// nothing to a person, so this is what waits for any auditor, oldest first; the queue is per journey, so "See all" opens the one journey that holds the work or the journey tiles. Its own states:
// a skeleton of three rows, a failure said with Retry (never "all caught up" over a failure), and the all-clear in one line. The rows are frontRules.ts waitingRows.
import Link from 'next/link';
import { clsx } from 'clsx';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { InfoTip } from '@/components/ui/InfoTip';
import { ErrorState, SkeletonRows, StatusPill } from '@/components/ui/ds';
import { linkClasses } from '@/components/ui/ds/linkModel';
import { formatCount } from '@/lib/format';
import type { WorkPayload } from '@/lib/auditorPortal/portalModel';
import { WAITING_ROWS, waitingRows, waitingTarget } from './frontRules';

export interface WaitingCardProps {
  id?: string;
  work: WorkPayload | undefined;
  now: Date;
  loading: boolean;
  failed: { message: string; onRetry?: () => void } | null;
}

export function WaitingCard({ id = 'work', work, now, loading, failed }: WaitingCardProps) {
  const total = work?.rows_total ?? 0;
  const rows = work ? waitingRows(work.rows, now) : [];
  const target = work ? waitingTarget(work.journeys) : undefined;
  const title = 'Waiting for a decision';
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="min-w-0 scroll-mt-[64px] rounded-ds-card border border-ds-border bg-ds-surface px-[16px] py-[12px]">
      <div className="flex flex-wrap items-center gap-x-[4px] gap-y-[4px]">
        <h2 id={`${id}-h`} className="min-w-0 break-words !text-ds-section !text-ds-fg">{title}</h2>
        <InfoTip text="The oldest files sent for review and scope requests waiting, across every journey. The platform does not assign them to a person, so they wait for any auditor. A row opens its journey with the decision ready." label={`About ${title.toLowerCase()}`} />
        {work && total > 0 && <span className="ml-[4px] text-ds-body text-ds-fg-muted">{formatCount(total)}</span>}
        {work && total > rows.length && target && (
          <Link href={target} aria-label={`See all ${formatCount(total)} files and scope requests waiting for a decision`} className={clsx('ml-auto inline-flex items-center gap-[2px]', linkClasses({ tone: 'text', size: 'label' }))}>
            {`See all ${formatCount(total)}`}
            <ArrowRight aria-hidden className="h-[14px] w-[14px] shrink-0" strokeWidth={2} />
          </Link>
        )}
      </div>

      {loading && !work && <div className="mt-[8px]"><SkeletonRows rows={WAITING_ROWS} columns={3} label="Loading what is waiting" /></div>}
      {failed && !work && <ErrorState compact title="Couldn't load what is waiting" message={failed.message} onRetry={failed.onRetry} />}
      {work && rows.length === 0 && (
        <p className="mt-[4px] flex min-h-[32px] items-center gap-[8px] text-ds-body text-ds-fg-muted">
          <CheckCircle2 aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-success" strokeWidth={1.75} />
          All caught up
        </p>
      )}
      {work && rows.length > 0 && (
        <ul aria-label={title} className="m-0 mt-[4px] list-none p-0">
          {rows.map((r) => (
            <li key={r.key} className="relative flex min-h-[40px] flex-wrap items-center gap-x-[8px] gap-y-[2px] border-t border-ds-border px-[4px] py-[4px] first:border-t-0 hover:bg-ds-surface-hover has-[:focus-visible]:bg-ds-surface-hover">
              <Link href={r.href} aria-label={r.name} className="min-w-0 flex-1 basis-[9rem] truncate rounded-ds-control text-ds-body font-[500] text-ds-fg after:absolute after:inset-0 hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{r.title}</Link>
              {r.wait && <StatusPill size="sm" tone={r.wait.tone} label={r.wait.text} className="shrink-0" />}
              <span aria-hidden className="shrink-0 text-ds-label font-[500] text-ds-primary-text">{r.action}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
