'use client';

// The Timeline tab: everything that happened to the issue, newest first, a day at a time, in plain lines (lib/issues/timeline.ts says each one: who did what, what changed, what a person
// wrote). It is a record for the people who check the work, so nothing is dropped; when the server answered with as many events as it was asked for, the tab says there may be earlier ones.
// A failed read says so with Retry (never "nothing has happened"). `EventRow` is also the Overview's "Latest activity".
import type { ReactNode } from 'react';
import {
  Activity, CheckCircle2, Circle, Link2, ListChecks, MessageSquare, Pencil, Plus, RotateCcw, ShieldCheck, type LucideIcon,
} from 'lucide-react';
import { EmptyState, ErrorState, Notice, SkeletonRows } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { timelineDays, type ActivityRow, type TimelineItem, type TimelineKind } from '@/lib/issues/timeline';
import { TIMELINE_LIMIT } from '../workspaceData';

export interface FeedState<T> { data: T | undefined; isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown }

const ICON: Record<TimelineKind, LucideIcon> = {
  raised: Plus, move: Activity, close: CheckCircle2, reopen: RotateCcw, edit: Pencil, comment: MessageSquare, action: ListChecks, link: Link2, register: ShieldCheck, other: Circle,
};
const TONE: Record<TimelineKind, string> = {
  raised: 'bg-ds-primary-soft text-ds-primary-text',
  move: 'bg-ds-primary-soft text-ds-primary-text',
  close: 'bg-ds-success-soft text-ds-success',
  reopen: 'bg-ds-warning-soft text-ds-warning',
  edit: 'bg-ds-surface-subtle text-ds-fg-muted',
  comment: 'bg-ds-surface-subtle text-ds-fg-muted',
  action: 'bg-ds-primary-soft text-ds-primary-text',
  link: 'bg-ds-info-soft text-ds-info',
  register: 'bg-ds-info-soft text-ds-info',
  other: 'bg-ds-surface-subtle text-ds-fg-muted',
};

export function EventRow({ item }: { item: TimelineItem }) {
  const Icon = ICON[item.kind];
  return (
    <li className="flex gap-[12px]">
      <span aria-hidden className={`mt-[2px] grid h-[24px] w-[24px] shrink-0 place-items-center rounded-full ${TONE[item.kind]}`}><Icon className="h-[14px] w-[14px]" /></span>
      <div className="min-w-0 flex-1">
        <p className="m-0 break-words text-ds-body font-[600] text-ds-fg">{item.line}</p>
        <p className="m-0 text-ds-label text-ds-fg-muted">{[item.who, item.time].filter(Boolean).join(' · ')}</p>
        {item.details.map((d, i) => <p key={`${i}-${d}`} className="m-0 mt-[2px] break-words text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{d}</p>)}
        {item.quote && <blockquote dir="auto" className="m-0 mt-[4px] whitespace-pre-line break-words border-l-2 border-ds-border-strong pl-[8px] text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{item.quote}</blockquote>}
      </div>
    </li>
  );
}

/** The skeleton, the failure with Retry, or the children: the one way every feed of this page reads. */
export function Feed<T>({ state, noun, children }: { state: FeedState<T>; noun: string; children: (data: T) => ReactNode }) {
  if (state.isPending) return <div aria-busy="true"><SkeletonRows rows={4} columns={2} label={`Loading the ${noun}`} /></div>;
  if (state.isError || state.data === undefined) return <ErrorState title={`Couldn't load the ${noun}`} message={errorMessage(state.error)} onRetry={() => { void state.refetch(); }} />;
  return <>{children(state.data)}</>;
}

export function TimelineTab({ events }: { events: FeedState<ActivityRow[]> }) {
  return (
    <Feed state={events} noun="timeline">
      {(rows) => {
        if (rows.length === 0) return <EmptyState bare kind="firstUse" title="Nothing has happened yet" description="Every move, edit, comment and link of this issue will be listed here." />;
        const days = timelineDays(rows);
        return (
          <div className="flex flex-col gap-[20px]">
            {rows.length >= TIMELINE_LIMIT && <Notice tone="info" title={`Showing the latest ${TIMELINE_LIMIT} events`}>There may be earlier ones.</Notice>}
            {days.map((day) => (
              <section key={day.key} aria-label={day.label}>
                <h3 className="m-0 mb-[8px] !text-ds-label !font-[600] !text-ds-fg-muted">{day.label}</h3>
                <ol className="m-0 flex list-none flex-col gap-[14px] p-0">{day.items.map((item) => <EventRow key={item.id} item={item} />)}</ol>
              </section>
            ))}
          </div>
        );
      }}
    </Feed>
  );
}
