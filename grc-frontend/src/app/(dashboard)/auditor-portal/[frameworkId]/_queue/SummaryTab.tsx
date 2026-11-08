'use client';

// The Summary tab: where the journey stands, in the numbers the Frameworks page shows (Ready and Implemented come from the journey's own figures, so this page and that
// one never disagree), what was sent and decided, and a door into each tab of the journey in Frameworks. The old Overview's six "linked artifact" tiles (three of them
// counted the whole organisation, and none opened anything) are gone: the artifacts of the journey are one link away. A figure that has not answered says so and never
// reads as 0.
import type { UseQueryResult } from '@tanstack/react-query';
import { ErrorState, Fact, FactList, SectionCard, StatTile, StatusPill, TitleLink } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount, formatPercent } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { readinessBandWords } from '@/lib/statuses/frameworkJourney';
import { frameworksHref, journeyHref, noun, summaryFigures, type QueuePayload } from '@/lib/auditorPortal/portalModel';
import type { JourneyProgressPayload } from '@/lib/journeyModel';
import type { CertificationJourney } from '@/types';

export interface SummaryTabProps {
  journeyId: number;
  queue: UseQueryResult<QueuePayload>;
  journey: UseQueryResult<CertificationJourney>;
}

const LINKS: ReadonlyArray<{ title: string; hint: string; tab?: 'controls' | 'scope' | 'artifacts' | 'activity' }> = [
  { title: 'Requirements', hint: 'Every requirement, its evidence and who owns it.', tab: 'controls' },
  { title: 'Scope and decisions', hint: 'Every request to put a requirement in or out of scope, with the reviewer’s side.', tab: 'scope' },
  { title: 'Documents and registers', hint: 'The policies, registers and artifacts of this framework.', tab: 'artifacts' },
  { title: 'Activity', hint: 'Snapshots of the journey over time and the report.', tab: 'activity' },
];

export function SummaryTab({ journeyId, queue, journey }: SummaryTabProps) {
  const counts = queue.data?.counts;
  const figures = summaryFigures(counts, (journey.data as { progress?: JourneyProgressPayload } | undefined)?.progress);
  const numbers = figures.journey;
  const journeyFailed = journey.isError && !journey.data
    ? { title: "The journey's figures aren't available", message: errorMessage(journey.error), onRetry: canRetry(journey.error) ? () => { void journey.refetch(); } : undefined }
    : null;
  const queueFailed = queue.isError && !counts;

  if (queueFailed) {
    return <ErrorState title="Couldn't load the summary" message={errorMessage(queue.error)} onRetry={canRetry(queue.error) ? () => { void queue.refetch(); } : undefined} />;
  }

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="grid grid-cols-2 gap-[12px] lg:grid-cols-4">
        <StatTile
          label="Ready"
          value={numbers ? formatPercent(numbers.readyPct) : null}
          loading={journey.isPending}
          error={journeyFailed}
          info="Share of the requirements in scope whose approved evidence reaches what the requirement asks for. A file nobody has approved does not count. The Frameworks page shows the same figure."
          note={figures.band ? <StatusPill size="sm" {...statusPill(readinessBandWords, figures.band)} /> : undefined}
          progress={numbers?.readyPct ?? null}
        />
        <StatTile
          label="Implemented"
          value={numbers ? formatPercent(numbers.implementedPct) : null}
          loading={journey.isPending}
          error={journeyFailed}
          info="Requirements in scope that are implemented or verified (a verified one is counted once)."
          note={numbers ? `${formatCount(numbers.implemented)} of ${formatCount(numbers.applicable)} in scope` : undefined}
          progress={numbers?.implementedPct ?? null}
        />
        <StatTile
          label="Files approved"
          value={figures.filesApproved === null ? null : formatPercent(figures.filesApproved)}
          loading={queue.isPending}
          info={figures.filesTotal === 0 ? 'No file has been sent for review yet.' : 'Files approved over every file sent for review on this journey.'}
          note={counts ? `${formatCount(counts.files.approved)} of ${formatCount(counts.files.total)} files` : undefined}
          progress={figures.filesApproved}
          link={counts && counts.files.pending > 0 ? { href: journeyHref(journeyId), label: `${counts.files.pending} files to review. Open the queue` } : undefined}
        />
        <StatTile
          label="Waiting for a decision"
          value={counts ? formatCount(figures.waiting) : null}
          loading={queue.isPending}
          tone={figures.waiting > 0 ? 'warning' : 'success'}
          info="Files to review plus scope requests waiting."
          note={counts ? `${noun(counts.files.pending, 'file', 'files')} · ${noun(counts.scope.pending, 'request', 'requests')}` : undefined}
          link={figures.waiting > 0 ? { href: journeyHref(journeyId), label: `${figures.waiting} waiting. Open the queue` } : undefined}
        />
      </div>

      {counts && (
        <SectionCard id="scope" title="Scope requests" info="Every request to put a requirement in or out of scope. A request waits until a reviewer decides it; the requirement stays as it is until then.">
          <FactList min={140}>
            <Fact label="Waiting">{formatCount(counts.scope.pending)}</Fact>
            <Fact label="In scope">{formatCount(counts.scope.in_scope)}</Fact>
            <Fact label="Out of scope">{formatCount(counts.scope.out_of_scope)}</Fact>
            <Fact label="Turned down">{formatCount(counts.scope.rejected)}</Fact>
            <Fact label="No request yet">{formatCount(counts.untouched)}</Fact>
          </FactList>
        </SectionCard>
      )}

      <SectionCard id="frameworks" title="In Frameworks" info="The requirements, the scope decisions, the documents and the activity of this journey are in Frameworks. The portal does not keep a second copy.">
        <ul className="m-0 grid list-none grid-cols-1 gap-x-[16px] gap-y-[8px] p-0 md:grid-cols-2">
          {LINKS.map((l) => (
            <li key={l.title} className="min-w-0">
              <TitleLink href={frameworksHref(journeyId, l.tab)} title={l.title} lines={1} tone="text" />
              <p className="text-ds-label text-ds-fg-muted">{l.hint}</p>
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}
