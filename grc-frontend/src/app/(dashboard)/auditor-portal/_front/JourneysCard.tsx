'use client';

// "Journeys under audit" on the front door: every certification journey with what waits on it (files to review, scope requests) and how much of its files is
// decided, the journeys with the most waiting first. Each name opens that journey's review queue. A search narrows the list; the list shows the first eight and
// says how many more there are. A journey with no files has no decided share (nothing to decide is not 0%). Its own states: a skeleton, a failure with Retry,
// and an empty list that says what to do about it.
import { useMemo, useState } from 'react';
import { Button, DebouncedSearch, EmptyState, ErrorState, ProgressBar, SectionCard, SkeletonRows, StatusPill, TitleLink } from '@/components/ui/ds';
import { formatCount } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { journeyStatus } from '@/lib/statuses/frameworkJourney';
import { decidedShare, journeyHref, matchJourneys, noun, orderJourneys, type JourneyCard, type WorkPayload } from '@/lib/auditorPortal/portalModel';

const FIRST = 8;

function Waiting({ n, one, other }: { n: number; one: string; other: string }) {
  return n > 0 ? <span className="font-[600] text-ds-fg">{noun(n, one, other)}</span> : <span className="text-ds-fg-muted">{`No ${other}`}</span>;
}

function Journey({ card }: { card: JourneyCard }) {
  const share = decidedShare(card);
  const decided = card.files.approved + card.files.rejected;
  return (
    <li className="border-t border-ds-border px-[8px] py-[10px] first:border-t-0">
      <div className="flex flex-wrap items-center justify-between gap-x-[8px] gap-y-[4px]">
        <TitleLink href={journeyHref(card.id)} title={card.name} lines={2} className="min-w-0 flex-1 basis-[10rem]" />
        <StatusPill size="sm" {...statusPill(journeyStatus, card.status)} />
      </div>
      {card.framework && <p className="mt-[2px] text-ds-label text-ds-fg-muted">{[card.framework, card.version].filter(Boolean).join(' · ')}</p>}
      <p className="mt-[6px] flex flex-wrap items-center gap-x-[12px] gap-y-[2px] text-ds-body">
        <Waiting n={card.files.pending} one="file to review" other="files to review" />
        <Waiting n={card.scope.pending} one="scope request" other="scope requests" />
      </p>
      <div className="mt-[6px]">
        <ProgressBar value={share} label={`${card.name}: files decided`} valueText={share === null ? undefined : `${formatCount(decided)} of ${formatCount(card.files.total)} files`} tone={share === 100 ? 'success' : 'primary'} />
      </div>
    </li>
  );
}

export interface JourneysCardProps {
  id: string;
  work: WorkPayload | undefined;
  loading: boolean;
  failed: { message: string; onRetry?: () => void } | null;
}

export function JourneysCard({ id, work, loading, failed }: JourneysCardProps) {
  const [term, setTerm] = useState('');
  const [all, setAll] = useState(false);
  const ordered = useMemo(() => orderJourneys(work?.journeys ?? []), [work]);
  const matches = useMemo(() => matchJourneys(ordered, term), [ordered, term]);
  const shown = all || term ? matches : matches.slice(0, FIRST);
  const cut = work && work.journeys_total > work.journeys.length;

  return (
    <SectionCard
      id={id}
      title="Journeys under audit"
      info="Every certification journey of the organisation, the ones with the most waiting first. A name opens that journey's review queue; the requirements themselves are in Frameworks."
      meta={work ? `${formatCount(work.journeys_total)} ${work.journeys_total === 1 ? 'journey' : 'journeys'}` : undefined}
    >
      {loading && !work && <SkeletonRows rows={4} columns={2} label="Loading the journeys" />}
      {failed && !work && <ErrorState compact title="Couldn't load the journeys" message={failed.message} onRetry={failed.onRetry} />}
      {work && work.journeys.length === 0 && (
        <EmptyState
          kind="firstUse"
          title="No journeys to audit yet"
          description="A journey starts from a framework. When one is started, its files and scope requests are reviewed here."
          action={<Button href="/frameworks" variant="primary">Open Frameworks</Button>}
          bare
        />
      )}
      {work && work.journeys.length > 0 && (
        <div className="flex flex-col gap-[8px]">
          {work.journeys.length > FIRST && <DebouncedSearch label="Search journeys" placeholder="Search journeys" value={term} onSearch={setTerm} />}
          {shown.length === 0 ? (
            <EmptyState kind="noMatches" title="No journey matches" description="Try another name or framework." onClearFilters={() => setTerm('')} bare />
          ) : (
            <ul aria-label="Journeys under audit" className="m-0 list-none p-0">
              {shown.map((card) => <Journey key={card.id} card={card} />)}
            </ul>
          )}
          {!all && !term && matches.length > FIRST && (
            <div className="flex flex-wrap items-center justify-between gap-[8px] border-t border-ds-border px-[8px] pt-[8px] text-ds-label text-ds-fg-muted">
              <span role="status">{`Showing ${formatCount(FIRST)} of ${formatCount(matches.length)}`}</span>
              <Button variant="link" size="sm" onClick={() => setAll(true)}>{`Show all ${formatCount(matches.length)}`}</Button>
            </div>
          )}
          {cut && <p role="status" className="px-[8px] text-ds-label text-ds-fg-muted">{`Showing the newest ${formatCount(work.journeys.length)} of ${formatCount(work.journeys_total)} journeys.`}</p>}
        </div>
      )}
    </SectionCard>
  );
}
