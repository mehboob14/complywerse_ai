'use client';

export const dynamic = 'force-dynamic';

// Assessments > Overview, a worklist-first cockpit (the frame the Governance, Risk and Compliance Overviews use: components/overview): what needs attention as a band of counters that each open
// the list they count, the signed-in person's own work ("Do now") beside one posture card, and the categories and the remediation clock below. Four requests (GET /overview, /my-work, /points,
// /sla-policy) and each part loads, fails (with Retry) and is empty on its own. Every figure is the SERVER's: the score and its grade (85 / 70 / 50), the SLA score and the gap counts; a figure
// that is not recorded says so and is never 0. A tenant with no assessment is shown how to start instead of a page of zeros. The strip of tabs (Overview, All assessments, Types) is under the head.
// The old board's cards, its in-place detail and its per-keystroke SLA panel are gone: an assessment opens in its own page, and "Tune SLA" is a dialog with one Save.
import { RefreshCw } from 'lucide-react';
import { usePermissions } from '@/hooks/usePermissions';
import { formatCount } from '@/lib/format';
import { clockOf } from '@/lib/inbox/inboxView';
import { PageHeader } from '@/components/ui';
import { Button, ErrorState, IconButton, Skeleton } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { Cockpit, SkipToWork, type Breakdown } from '@/components/overview/Cockpit';
import { CounterBand, type BandCounter } from '@/components/overview/CounterBand';
import { layoutOf, workRowLimit } from '@/components/overview/cockpitModel';
import { useNarrow } from '@/components/overview/useNarrow';
import { AssessmentTabs } from './_tabs/AssessmentTabs';
import { AREA } from './_tabs/tabsModel';
import { StartMenu } from './_types/StartMenu';
import { useAssessmentCount, useBoard, useMyWork, usePoints, usePolicy, WORK_LIMIT } from './_data/assessmentData';
import { CategoriesBody, ClockBody, DoNowCard, EmptyOverview, PostureCard, type Load } from './_overview/OverviewParts';
import { attentionTotal, countersOf, mineTotal, workRows } from './_overview/overviewModel';

function OverviewSkeleton() {
  const card = 'rounded-ds-card border border-ds-border bg-ds-surface p-[16px]';
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-[16px]">
      <span className="sr-only">Loading the overview</span>
      <div aria-hidden className={card}><Skeleton className="h-[16px] w-[140px]" /><Skeleton className="mt-[12px] h-[32px] w-full" /></div>
      <div aria-hidden className="grid gap-[16px] lg:grid-cols-[8fr_5fr]">
        {[0, 1].map((i) => <div key={i} className={card}><Skeleton className="h-[16px] w-[140px]" /><Skeleton className="mt-[16px] h-[12px] w-full" /><Skeleton className="mt-[8px] h-[12px] w-[70%]" /><Skeleton className="mt-[8px] h-[12px] w-[85%]" /></div>)}
      </div>
    </div>
  );
}

// a request that failed says so only when it has nothing to show: a refresh that fails keeps the answer the person already has (as the Business Continuity Overview does)
const loadOf = (q: { isPending: boolean; isError: boolean; error: unknown; data: unknown; refetch: () => unknown }): Load => ({ loading: q.isPending && !q.isError, error: q.isError && q.data === undefined ? q.error : null, retry: () => { void q.refetch(); } });

export default function AssessmentsOverviewPage() {
  const narrow = useNarrow();
  const { hasPermission } = usePermissions();
  const canTune = hasPermission('compliance:assessments:edit');
  const count = useAssessmentCount();
  const board = useBoard();
  const work = useMyWork(WORK_LIMIT);
  const points = usePoints();
  const policy = usePolicy();

  const boardLoad = loadOf(board);
  const workLoad = loadOf(work);
  const pointsLoad = loadOf(points);

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

  const counters = countersOf(board.data, work.data);
  const total = attentionTotal(counters);
  const band: BandCounter[] = counters.map((c) => {
    const q = c.source === 'work' ? workLoad : boardLoad;
    const state = q.loading ? 'loading' : q.error ? 'error' : c.value === null ? 'none' : 'ready';
    return { key: c.key, label: c.label, href: c.href, tone: c.tone, state, value: c.value ?? undefined, onRetry: state === 'error' ? q.retry : undefined };
  });
  const rows = workRows(work.data);
  const mine = mineTotal(work.data);
  const mode = layoutOf({ refused: false, workCount: mine });

  const breakdowns: Breakdown[] = [
    { id: 'categories', title: 'By category', info: 'Every assessment the board scores, grouped as the server groups them, with the average score of the group. A row opens the assessments of that category.', actions: <Button size="sm" variant="link" href="/assessments/register">All assessments</Button>, children: <CategoriesBody board={board.data} load={boardLoad} /> },
    {
      id: 'clock', title: 'Remediation clock', size: 'wide',
      info: 'Gaps are the controls that are not complied with or that have a fix under way. A gap is due on its own date, or when its priority allows from the day it was raised; the days are your organization\'s SLA days. The counts are the server\'s; the due-soon count and the bar are worked out from each gap\'s date.',
      children: <ClockBody board={board.data} points={points.data} policy={policy.data} boardLoad={boardLoad} pointsLoad={pointsLoad} canTune={canTune} />,
    },
  ];

  return (
    <div className="flex flex-col gap-[16px]">
      <SkipToWork />
      {head}
      <Cockpit
        mode={mode}
        narrow={narrow}
        refusal={null}
        band={(
          <CounterBand
            id="attention"
            title="Needs attention"
            info="Each count opens what it counts: evidence to decide in Needs my action, the rest in All assessments. Counts of controls and gaps are not counts of assessments, so the list a count opens can be shorter."
            total={total !== null ? `${formatCount(total)} in total` : undefined}
            counters={band}
            narrow={narrow}
          />
        )}
        work={<DoNowCard rows={rows} total={mine} limit={workRowLimit(mode, narrow)} load={workLoad} />}
        posture={<PostureCard board={board.data} load={boardLoad} />}
        breakdowns={breakdowns}
      />
    </div>
  );
}
