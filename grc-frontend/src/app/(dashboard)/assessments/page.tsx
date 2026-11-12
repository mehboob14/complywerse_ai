'use client';

export const dynamic = 'force-dynamic';

// Assessments > Overview, a posture dashboard on the cockpit frame (components/overview), Overview v2: four tiles (the server's score, the remediation SLA, how many assessments, the gaps still open) and four
// cards (_overview/Visuals.tsx: the score by category as small multiples, the assessments by grade, the five lowest, the gaps by state and by due date), then the signed-in person's own work as one slim card
// (three one-line rows and "See all"). There is no wall of counters: attention is the colour of the graphics (an overdue gap is the red part of a bar). Every tile, card title, category, slice and bar opens
// the register already filtered to it (?category= ?grade= ?quick= ?sort=). The "what if" day of the gaps card is in the address (`?asof=`), and `useReturnToPlace` puts a person who comes back (Back, or a
// module's own back link) on the same view at the same scroll position once the data has rendered. Four requests (GET /overview, /my-work, /points, /sla-policy) and each part loads, fails (with Retry) and is
// empty on its own. Every figure is the SERVER's: the score and its grade (85 / 70 / 50), the SLA score and the gap counts; a figure that is not recorded says so and is never 0. A tenant with no assessment is
// shown how to start instead of a page of zeros. The strip of tabs (Overview, All assessments, Types) is under the head. "Tune SLA" is a dialog with one Save.
import { RefreshCw } from 'lucide-react';
import { usePermissions } from '@/hooks/usePermissions';
import { clockOf } from '@/lib/inbox/inboxView';
import { PageHeader } from '@/components/ui';
import { Button, ErrorState, IconButton, Skeleton, useAddressState } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { Cockpit, SkipToWork } from '@/components/overview/Cockpit';
import { useReturnToPlace } from '@/components/overview/useReturnToPlace';
import { text } from '@/lib/addressState';
import { AssessmentTabs } from './_tabs/AssessmentTabs';
import { AREA } from './_tabs/tabsModel';
import { StartMenu } from './_types/StartMenu';
import { useAssessmentCount, useBoard, useMyWork, usePoints, usePolicy, WORK_LIMIT } from './_data/assessmentData';
import { EmptyOverview, MyWorkCard, type Load } from './_overview/OverviewParts';
import { Charts, Tiles } from './_overview/Visuals';
import { workRows } from './_overview/overviewModel';

/** Defined once, outside the component (useAddressState reads the address again for a new schema). */
const SCHEMA = { asof: text() };

function OverviewSkeleton() {
  const card = 'rounded-ds-card border border-ds-border bg-ds-surface p-[16px]';
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-[16px]">
      <span className="sr-only">Loading the overview</span>
      <div aria-hidden className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-[12px]">
        {[0, 1, 2, 3].map((i) => <div key={i} className={card}><Skeleton className="h-[12px] w-[90px]" /><Skeleton className="mt-[12px] h-[28px] w-[70px]" /><Skeleton className="mt-[12px] h-[8px] w-full" /></div>)}
      </div>
      <div aria-hidden className="grid gap-[16px] lg:grid-cols-[7fr_5fr]">
        {[0, 1].map((i) => <div key={i} className={card}><Skeleton className="h-[16px] w-[140px]" /><Skeleton className="mt-[16px] h-[132px] w-full" /></div>)}
      </div>
      <div aria-hidden className="grid gap-[16px] lg:grid-cols-2">
        {[0, 1].map((i) => <div key={i} className={card}><Skeleton className="h-[16px] w-[140px]" /><Skeleton className="mt-[16px] h-[100px] w-full" /></div>)}
      </div>
    </div>
  );
}

// a request that failed says so only when it has nothing to show: a refresh that fails keeps the answer the person already has (as the Business Continuity Overview does)
const loadOf = (q: { isPending: boolean; isError: boolean; error: unknown; data: unknown; refetch: () => unknown }): Load => ({ loading: q.isPending && !q.isError, error: q.isError && q.data === undefined ? q.error : null, retry: () => { void q.refetch(); } });

export default function AssessmentsOverviewPage() {
  const { hasPermission } = usePermissions();
  const canTune = hasPermission('compliance:assessments:edit');
  const [address, setAddress] = useAddressState(SCHEMA);
  const count = useAssessmentCount();
  const board = useBoard();
  const work = useMyWork(WORK_LIMIT);
  const points = usePoints();
  const policy = usePolicy();

  const boardLoad = loadOf(board);
  const workLoad = loadOf(work);
  const pointsLoad = loadOf(points);

  // the page is drawn once its requests have answered or failed: that is when the place a person left is put back
  useReturnToPlace(!count.isPending && !board.isPending && !work.isPending && !points.isPending);

  const refresh = () => { void board.refetch(); void work.refetch(); void points.refetch(); void count.refetch(); void policy.refetch(); };
  const head = (
    <div className="flex flex-col gap-[12px]">
      <PageHeader
        variant="page"
        title={AREA}
        info="Every assessment at a glance, and what needs you. Start one, or open the list of all of them."
        meta={board.data && board.dataUpdatedAt > 0 ? (
          <span className="inline-flex items-center gap-[2px]">{`Updated ${clockOf(board.dataUpdatedAt)}`}<IconButton label="Refresh the overview" onClick={refresh}><RefreshCw aria-hidden /></IconButton></span>
        ) : undefined}
        actions={<StartMenu />}
      />
      <AssessmentTabs />
    </div>
  );

  if (count.isError && !count.data && board.isError && work.isError) {
    return (
      <div className="flex flex-col gap-[16px]">
        {head}
        <ErrorState title="Couldn't load the overview" message={errorMessage(board.error)} onRetry={canRetry(board.error) ? refresh : undefined} />
      </div>
    );
  }
  if (count.isPending && board.isPending && work.isPending) return <div className="flex flex-col gap-[16px]">{head}<OverviewSkeleton /></div>;
  if (count.data === 0) return <div className="flex flex-col gap-[16px]">{head}<EmptyOverview action={<div className="flex flex-wrap justify-center gap-[8px]"><StartMenu /><Button href="/assessments/types">Upload a workbook</Button></div>} /></div>;

  return (
    <div className="flex flex-col gap-[16px]">
      <SkipToWork />
      {head}
      <Cockpit
        hero={<Tiles board={board.data} load={boardLoad} />}
        visuals={(
          <Charts
            board={board.data} load={boardLoad} points={points.data} pointsLoad={pointsLoad} policy={policy.data} canTune={canTune}
            asof={address.asof} onAsof={(day) => setAddress({ asof: day })}
          />
        )}
        work={<MyWorkCard rows={workRows(work.data)} work={work.data} load={workLoad} />}
      />
    </div>
  );
}
