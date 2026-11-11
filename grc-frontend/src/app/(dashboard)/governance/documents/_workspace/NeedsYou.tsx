'use client';

// "Needs you": the signed-in person's own tasks on documents ("Things you need to do", design E), above the library's list. Each is a whole-row link that opens the document at the right
// step, with a plain verb ("Read and confirm: ..."), one plain status word (Late, Needs you) and one hint ("Due in 5 days", "Bina Branch sent this to you 6 days ago"). The tasks are the
// inbox's (lib/inbox: the same requests, the same order and the same counts as the top bar's badge and the Needs-my-action page; components/overview/workList.ts narrows it to the two
// document sources), at most five, "See all" goes to Needs my action. Its own states: a skeleton while the requests load, a failed source said with Retry (never "Nothing needs you" over a
// failure), a source that could not be refreshed said beside what is shown, and an all-clear. It decides nothing: the document opens where it is decided.
//   <NeedsYou inbox={inbox} now={now} onRetry={refetch} fetching={fetchingSource} link={docLink} />
import { useMemo } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, RotateCw } from 'lucide-react';
import { Button, ErrorState, Notice, SectionCard, SkeletonRows, StatusPill, TitleLink } from '@/components/ui/ds';
import { workOf, seeAllHref } from '@/components/overview/workList';
import { formatCount } from '@/lib/format';
import type { Inbox, SourceId } from '@/lib/inbox/buildInbox';
import { clockOf } from '@/lib/inbox/inboxView';
import { NEEDS_YOU_LIMIT, NEEDS_YOU_SOURCES, needsYou } from './libraryNeedsYou';

export interface NeedsYouProps {
  inbox: Inbox;
  /** the instant the hints are read at */
  now: Date;
  /** a source that could not be loaded asks again */
  onRetry: (source: SourceId) => void;
  /** the sources being asked right now (a Retry shows it) */
  fetching?: Partial<Record<SourceId, boolean>>;
  /** every address the strip links to goes through this: the library adds the place the person came from (?from=) */
  link?: (href: string) => string;
  limit?: number;
}

const keep = (href: string) => href;

export function NeedsYou({ inbox, now, onRetry, fetching = {}, link = keep, limit = NEEDS_YOU_LIMIT }: NeedsYouProps) {
  const work = useMemo(() => workOf(inbox, NEEDS_YOU_SOURCES), [inbox]);
  const strip = useMemo(() => needsYou(work, now, limit), [work, now, limit]);
  const failed = work.notices.filter((n) => n.state === 'unavailable');
  const { total, late } = strip;

  return (
    <SectionCard
      id="needs-you"
      title="Needs you"
      info="What you are asked to read, check or sign on documents. It is the same list as Needs my action."
      meta={work.state === 'content' ? <>{`${formatCount(total)} ${total === 1 ? 'item' : 'items'}`}{late > 0 && <> · <span className="font-[600] text-ds-danger">{`${formatCount(late)} late`}</span></>}</> : undefined}
    >
      {work.state === 'loading' && <SkeletonRows rows={3} columns={3} label="Loading what needs you" />}

      {work.state === 'unavailable' && (
        <ErrorState compact title="Couldn't load what needs you" message={failed[0]?.message} onRetry={() => failed.forEach((n) => onRetry(n.source))} />
      )}

      {work.state === 'empty' && (
        <p className="m-0 flex items-center gap-[8px] px-[4px] py-[8px] text-ds-body text-ds-fg-muted">
          <CheckCircle2 aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-success" strokeWidth={1.75} />
          Nothing needs you
        </p>
      )}

      {work.state === 'content' && (
        <>
          {work.notices.map((n) => (
            <Notice
              key={n.source}
              tone={n.state === 'unavailable' ? 'warning' : 'info'}
              title={n.state === 'unavailable' ? `${n.label} could not be loaded` : `${n.label} could not be refreshed`}
              className="mb-[8px]"
              action={<Button leftIcon={<RotateCw aria-hidden />} loading={!!fetching[n.source]} onClick={() => onRetry(n.source)}>Retry</Button>}
            >
              {n.state === 'unavailable' ? `${n.message} What it holds is not in this list.` : `Showing what it said at ${clockOf(n.at)}.`}
            </Notice>
          ))}
          <ul aria-label="Needs you" className="m-0 list-none p-0">
            {strip.rows.map((r) => (
              <li key={r.key} className="border-t border-ds-border first:border-t-0">
                <Link
                  href={link(r.href)}
                  prefetch={false}
                  className="flex min-w-0 items-center gap-[12px] rounded-ds-control px-[8px] py-[10px] hover:bg-ds-surface-hover focus-visible:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring"
                >
                  <span aria-hidden className="grid h-[24px] w-[24px] shrink-0 place-items-center rounded-full bg-ds-primary-soft text-ds-primary-text">
                    <ArrowRight className="h-[14px] w-[14px]" strokeWidth={2} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span dir="auto" className="line-clamp-2 block text-ds-body font-[500] text-ds-fg [overflow-wrap:anywhere]">{r.title}</span>
                    {r.hint && <span className={`block text-ds-label ${r.late ? 'font-[600] text-ds-danger' : 'text-ds-fg-muted'}`}>{r.hint}</span>}
                  </span>
                  <StatusPill size="sm" tone={r.late ? 'danger' : 'pending'} label={r.word} className="shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-[4px] flex flex-wrap items-center justify-between gap-x-[12px] gap-y-[4px] border-t border-ds-border px-[8px] pt-[8px] text-ds-label text-ds-fg-muted">
            <span role="status">{strip.cut ? `Showing ${formatCount(strip.rows.length)} of ${formatCount(total)}` : `${formatCount(total)} ${total === 1 ? 'item' : 'items'}`}</span>
            <TitleLink href={link(seeAllHref('all'))} title={strip.cut ? `See all ${formatCount(total)}` : 'Open Needs my action'} lines={1} tone="text" size="label" />
          </div>
        </>
      )}
    </SectionCard>
  );
}
