'use client';

// Auditor Portal > the front door (Overview v2: posture in graphics, minimal text, everything opens the records, Back returns to the same place). Six figures an auditor acts on (files to review,
// scope requests, the oldest wait, what was decided this month, open and overdue observations), each the way into the records it counts; three rows of graphics: the review work (sent and decided per
// month, what waits by age), the journeys under audit as small multiples (a tile per journey: the share of its files decided, amber when something waits) and the requirements by scope, and the
// observations of Statutory Audit (priority by status, deadlines, regulators); then the oldest files and scope requests, slim: three one-line rows and "See all N". Every request loads, fails and has
// nothing on its own: the work and the journeys come from GET /auditor-portal/work (no journey progress is computed for it), the charts from /work/summary and from the observations summary of
// Statutory Audit, and a failed request is said where its numbers would be, never as 0 and never as "nothing is waiting". Nothing on this page changes what it shows (no view, filter or toggle), so
// the address keeps nothing; useReturnToPlace puts the page back where it was when the person comes Back from a journey or a register.
import { useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { IconButton } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { Cockpit, SkipToWork } from '@/components/overview/Cockpit';
import { useReturnToPlace } from '@/components/overview/useReturnToPlace';
import { clockOf } from '@/lib/inbox/inboxView';
import { titleFor } from '@/lib/navRegistry';
import { FrontKpis } from './_front/FrontKpis';
import { FrontVisuals } from './_front/FrontVisuals';
import { WaitingCard } from './_front/WaitingCard';
import { useObservationSummary, useWork, useWorkSummary } from './_front/portalData';

export default function AuditorPortalPage() {
  const work = useWork();
  const summary = useWorkSummary();
  const observations = useObservationSummary();

  const data = work.data;
  const workFailed = work.isError && !data;
  const retryWork = canRetry(work.error) ? () => { void work.refetch(); } : undefined;
  const failure = workFailed ? { message: errorMessage(work.error), onRetry: retryWork } : null;
  const now = useMemo(() => new Date(), [work.dataUpdatedAt]);          // eslint-disable-line react-hooks/exhaustive-deps
  useReturnToPlace(!work.isPending && !summary.isPending && !observations.isPending);
  const updated = work.dataUpdatedAt > 0 ? `Updated ${clockOf(work.dataUpdatedAt)}` : undefined;
  const refresh = () => { void work.refetch(); void summary.refetch(); void observations.refetch(); };

  return (
    <div className="flex flex-col gap-[16px]">
      <SkipToWork />
      <PageHeader
        variant="page"
        title={titleFor('/auditor-portal') ?? 'Auditor Portal Overview'}
        info="What waits for an auditor across every certification journey and how the work is going, with the observations of Statutory Audit beside it. The requirements themselves are in Frameworks."
        meta={<span className="inline-flex items-center gap-[2px]">{updated}<IconButton label="Refresh the portal" onClick={refresh}><RefreshCw aria-hidden /></IconButton></span>}
      />
      <Cockpit
        hero={<FrontKpis work={work} summary={summary} observations={observations} />}
        visuals={<FrontVisuals work={work} summary={summary} observations={observations} />}
        work={<WaitingCard id="work" work={data} now={now} loading={work.isPending} failed={failure} />}
      />
    </div>
  );
}
