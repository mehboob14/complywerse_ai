'use client';

// "Waiting for a decision" on the front door: the oldest files and scope requests across every journey, one action per row, each opening its journey's queue with the
// decision sheet already open. There is no assignment in the platform, so this is what waits for any auditor, oldest first. Its own states: a skeleton while the
// request runs, a failure said with Retry (never "all caught up" over a failure), an all-clear, and "Showing 20 of 56" when the server holds more than it listed.
import { CheckCircle2 } from 'lucide-react';
import { ErrorState, SectionCard, SkeletonRows, TitleLink, WorkRow } from '@/components/ui/ds';
import { formatCount, formatDate } from '@/lib/format';
import { rowHref, type WorkPayload, type WorkRowPayload } from '@/lib/auditorPortal/portalModel';

const KIND = { file: { label: 'File', tone: 'progress' }, scope: { label: 'Scope request', tone: 'pending' } } as const;

function contextOf(row: WorkRowPayload): string {
  return [row.journey, row.context, row.since ? `waiting since ${formatDate(row.since)}` : null].filter(Boolean).join(' · ');
}

export interface DoNowCardProps {
  id: string;
  work: WorkPayload | undefined;
  loading: boolean;
  failed: { message: string; onRetry?: () => void } | null;
}

export function DoNowCard({ id, work, loading, failed }: DoNowCardProps) {
  const rows = work?.rows ?? [];
  const total = work?.rows_total ?? 0;
  return (
    <SectionCard
      id={id}
      title="Waiting for a decision"
      info="The oldest files sent for review and scope requests waiting, across every journey. The platform does not assign them to a person, so they wait for any auditor. A row opens its journey with the decision ready."
      meta={work ? `${formatCount(total)} ${total === 1 ? 'item' : 'items'}` : undefined}
    >
      {loading && !work && <SkeletonRows rows={5} columns={3} label="Loading what is waiting" />}
      {failed && !work && <ErrorState compact title="Couldn't load what is waiting" message={failed.message} onRetry={failed.onRetry} />}
      {work && rows.length === 0 && (
        <p className="flex items-center gap-[8px] px-[4px] py-[8px] text-ds-body text-ds-fg-muted">
          <CheckCircle2 aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-success" strokeWidth={1.75} />
          Nothing is waiting. New files and scope requests appear here.
        </p>
      )}
      {work && rows.length > 0 && (
        <>
          <ul aria-label="Waiting for a decision" className="m-0 list-none p-0">
            {rows.map((row) => (
              <WorkRow
                key={`${row.kind}-${row.id}`}
                kind={KIND[row.kind]}
                title={row.title || (row.kind === 'file' ? 'A file' : 'A scope request')}
                href={rowHref(row)}
                context={contextOf(row)}
                requester={row.by ? { name: row.by, role: row.kind === 'file' ? 'Sent by' : 'Asked by' } : undefined}
                action={{ label: row.kind === 'file' ? 'Review' : 'Decide', href: rowHref(row) }}
              />
            ))}
          </ul>
          {total > rows.length && (
            <div className="mt-[4px] flex flex-wrap items-center justify-between gap-x-[12px] gap-y-[4px] border-t border-ds-border px-[8px] pt-[8px] text-ds-label text-ds-fg-muted">
              <span role="status">{`Showing the oldest ${formatCount(rows.length)} of ${formatCount(total)}`}</span>
              <TitleLink href="#journeys" title="Open a journey for the rest" lines={1} tone="text" size="label" />
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}
