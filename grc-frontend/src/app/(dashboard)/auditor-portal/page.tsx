'use client';

// Auditor Portal > the front door: a worklist-first cockpit (the Overview design lab's option A, the frame the Governance and Risk Overviews use). What waits for an
// auditor as a band of counters (each opens the queue of the journey that holds it), the oldest files and scope requests as rows that open their decision, and the
// journeys under audit with what waits on each. It replaces a picker of journey cards. Every request loads, fails and has nothing on its own: the work and the
// journeys come from GET /auditor-portal/work (no journey progress is computed for it), the open-observations counter from Statutory Audit's own counts, and a failed
// request is said where its numbers would be, never as 0 and never as "nothing is waiting".
import { RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { IconButton } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { Cockpit, SkipToWork } from '@/components/overview/Cockpit';
import { CounterBand, type BandCounter } from '@/components/overview/CounterBand';
import { layoutOf } from '@/components/overview/cockpitModel';
import { useNarrow } from '@/components/overview/useNarrow';
import { formatCount } from '@/lib/format';
import { clockOf } from '@/lib/inbox/inboxView';
import { titleFor } from '@/lib/navRegistry';
import { counterTarget, openObservations } from '@/lib/auditorPortal/portalModel';
import { DoNowCard } from './_front/DoNowCard';
import { JourneysCard } from './_front/JourneysCard';
import { useObservationMeta, useWork } from './_front/portalData';

export default function AuditorPortalPage() {
  const narrow = useNarrow();
  const work = useWork();
  const meta = useObservationMeta();

  const data = work.data;
  const cards = data?.journeys ?? [];
  const workFailed = work.isError && !data;
  const workState = (): BandCounter['state'] => (work.isPending ? 'loading' : workFailed ? 'error' : 'ready');
  const retryWork = canRetry(work.error) ? () => { void work.refetch(); } : undefined;
  const open = openObservations(meta.data);
  const counters: BandCounter[] = [
    { key: 'files', label: 'Files to review', href: counterTarget('files', cards), tone: 'pending', state: workState(), value: data?.counters.files_to_review, onRetry: workFailed ? retryWork : undefined },
    { key: 'scope', label: 'Scope requests', href: counterTarget('scope', cards), tone: 'pending', state: workState(), value: data?.counters.scope_to_decide, onRetry: workFailed ? retryWork : undefined },
    {
      key: 'observations', label: 'Open observations', href: '/auditor-portal/statutory-audit', tone: 'warning',
      state: meta.isPending ? 'loading' : open === null ? (meta.isError ? 'error' : 'none') : 'ready', value: open ?? undefined,
      onRetry: meta.isError && canRetry(meta.error) ? () => { void meta.refetch(); } : undefined,
    },
  ];
  const waiting = data ? data.counters.files_to_review + data.counters.scope_to_decide : null;
  const failure = workFailed ? { message: errorMessage(work.error), onRetry: retryWork } : null;
  const mode = layoutOf({ refused: false, workCount: data ? data.rows_total : null });
  const updated = work.dataUpdatedAt > 0 ? `Updated ${clockOf(work.dataUpdatedAt)}` : undefined;
  const refresh = () => { void work.refetch(); void meta.refetch(); };

  return (
    <div className="flex flex-col gap-[16px]">
      <SkipToWork />
      <PageHeader
        variant="page"
        title={titleFor('/auditor-portal') ?? 'Auditor Portal Overview'}
        info="What waits for an auditor across every certification journey, and the journeys it waits on. The requirements themselves are in Frameworks."
        meta={<span className="inline-flex items-center gap-[2px]">{updated}<IconButton label="Refresh the portal" onClick={refresh}><RefreshCw aria-hidden /></IconButton></span>}
      />
      <Cockpit
        mode={mode}
        narrow={narrow}
        band={(
          <CounterBand
            id="attention"
            title="Needs a decision"
            info="Each count opens the queue of the journey that holds it; when several journeys hold some, it takes you to the journeys below. Open observations are the ones not yet in a final status in Statutory Audit."
            total={waiting !== null ? `${formatCount(waiting)} waiting` : undefined}
            counters={counters}
            narrow={narrow}
            failure={workFailed && meta.isError ? { title: "Couldn't load the counters", message: errorMessage(work.error), onRetry: () => { refresh(); } } : undefined}
          />
        )}
        work={<DoNowCard id="work" work={data} loading={work.isPending} failed={failure} />}
        posture={<JourneysCard id="journeys" work={data} loading={work.isPending} failed={failure} />}
        breakdowns={[]}
      />
    </div>
  );
}
