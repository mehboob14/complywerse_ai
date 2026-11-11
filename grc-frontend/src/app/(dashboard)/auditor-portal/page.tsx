'use client';

// Auditor Portal > the front door: a dashboard that leads with the audit work in pictures and keeps the work itself under them. Six figures an auditor acts on (files to review, scope
// requests, the oldest wait, what was decided this month, open and overdue observations), each the way into the records it counts; graphs of the review work (sent and decided per
// month, what waits by age, the files of each journey by decision, the requirements by scope) and of the observations (priority by status, deadlines, registered and closed, regulators);
// then the oldest files and scope requests as rows that open their decision, and the journeys under audit with what waits on each. Every request loads, fails and has nothing on its
// own: the work and the journeys come from GET /auditor-portal/work (no journey progress is computed for it), the charts from /work/summary and from the observations summary of
// Statutory Audit, and a failed request is said where its numbers would be, never as 0 and never as "nothing is waiting".
import { RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { IconButton } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { Cockpit, SkipToWork } from '@/components/overview/Cockpit';
import { layoutOf } from '@/components/overview/cockpitModel';
import { useNarrow } from '@/components/overview/useNarrow';
import { clockOf } from '@/lib/inbox/inboxView';
import { titleFor } from '@/lib/navRegistry';
import { DoNowCard } from './_front/DoNowCard';
import { FrontKpis } from './_front/FrontKpis';
import { FrontVisuals } from './_front/FrontVisuals';
import { JourneysCard } from './_front/JourneysCard';
import { useObservationSummary, useWork, useWorkSummary } from './_front/portalData';

export default function AuditorPortalPage() {
  const narrow = useNarrow();
  const work = useWork();
  const summary = useWorkSummary();
  const observations = useObservationSummary();

  const data = work.data;
  const workFailed = work.isError && !data;
  const retryWork = canRetry(work.error) ? () => { void work.refetch(); } : undefined;
  const failure = workFailed ? { message: errorMessage(work.error), onRetry: retryWork } : null;
  const mode = layoutOf({ refused: false, workCount: data ? data.rows_total : null });
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
        mode={mode}
        narrow={narrow}
        hero={<FrontKpis work={work} summary={summary} observations={observations} />}
        band={null}
        visuals={<FrontVisuals work={work} summary={summary} observations={observations} />}
        work={<DoNowCard id="work" work={data} loading={work.isPending} failed={failure} />}
        posture={<JourneysCard id="journeys" work={data} loading={work.isPending} failed={failure} />}
        breakdowns={[]}
      />
    </div>
  );
}
