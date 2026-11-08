'use client';

export const dynamic = 'force-dynamic';

// Business Continuity > Overview, a worklist-first cockpit (the frame the Governance, Risk and Compliance Overviews use: components/overview): what needs attention as a band of counters that
// each open the list they count, the signed-in person's own work ("Do now") beside one posture card, and the breakdowns below. One request (GET /bcm/dashboard, key ['bcm-dashboard'],
// refreshed every minute) holds every figure and they are the SERVER's: nothing is recomputed here, a figure that is not recorded says so and is never 0, a failed request says what the
// server said with Retry (and none for a refusal), and a tenant with nothing yet is shown how to start instead of a page of zeros. The strip of tabs is under the head.
import { useState } from 'react';
import { CalendarClock, ClipboardList, Plus, RefreshCw } from 'lucide-react';
import { usePermissions } from '@/hooks/usePermissions';
import { formatCount } from '@/lib/format';
import { clockOf } from '@/lib/inbox/inboxView';
import { PageHeader } from '@/components/ui';
import { Button, EmptyState, ErrorState, IconButton, Skeleton } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { Cockpit, SkipToWork, type Breakdown } from '@/components/overview/Cockpit';
import { CounterBand, type BandCounter } from '@/components/overview/CounterBand';
import { layoutOf, workRowLimit } from '@/components/overview/cockpitModel';
import { useNarrow } from '@/components/overview/useNarrow';
import { BcmTabs } from './_tabs/BcmTabs';
import { AREA } from './_tabs/tabsModel';
import { DoNowCard, FindingsBySeverity, Linkage, PlansByStatus, PostureCard, RecentActivity } from './_overview/OverviewParts';
import { attentionTotal, countersOf, mineTotal, workItems } from './_overview/overviewModel';
import { useDashboard } from './bcmData';
import { isEmptyTenant } from './bcmModel';

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

export default function BcmOverviewPage() {
  const narrow = useNarrow();
  const { hasPermission } = usePermissions();
  const canPlan = hasPermission('bcm:plans:create');
  const canDrill = hasPermission('bcm:drills:create');
  const query = useDashboard();
  const d = query.data;
  const [now] = useState(() => Date.now());

  const head = (
    <div className="flex flex-col gap-[12px]">
      <PageHeader
        variant="page"
        title={AREA}
        info="Plans, drills and continuity testing at a glance, and what needs you."
        meta={d && query.dataUpdatedAt > 0 ? (
          <span className="inline-flex items-center gap-[2px]">{`Updated ${clockOf(query.dataUpdatedAt)}`}<IconButton label="Refresh the overview" onClick={() => { void query.refetch(); }}><RefreshCw aria-hidden /></IconButton></span>
        ) : undefined}
        actions={canDrill ? <Button variant="primary" href="/bcm/drills?new=1" leftIcon={<CalendarClock aria-hidden />}>Schedule drill</Button>
          : canPlan ? <Button variant="primary" href="/bcm/plans?new=1" leftIcon={<Plus aria-hidden />}>Add plan</Button> : undefined}
      />
      <BcmTabs />
    </div>
  );

  if (query.isError && !d) {
    return (
      <div className="flex flex-col gap-[16px]">
        {head}
        <ErrorState title="Couldn't load the overview" message={errorMessage(query.error)} onRetry={canRetry(query.error) ? () => { void query.refetch(); } : undefined} />
      </div>
    );
  }
  if (!d) return <div className="flex flex-col gap-[16px]">{head}<OverviewSkeleton /></div>;

  if (isEmptyTenant(d)) {
    return (
      <div className="flex flex-col gap-[16px]">
        {head}
        <EmptyState
          kind="firstUse"
          icon={ClipboardList}
          title="No continuity plans yet"
          description={canPlan ? 'Start with a plan: add its business impact analysis, then schedule drills to test it.' : 'No continuity plan has been created yet.'}
          action={canPlan ? <Button variant="primary" href="/bcm/plans?new=1" leftIcon={<Plus aria-hidden />}>Create a plan</Button> : <Button href="/bcm/plans">Open the plans</Button>}
        />
      </div>
    );
  }

  const counters = countersOf(d);
  const total = attentionTotal(counters);
  const band: BandCounter[] = counters.map((c) => ({ key: c.key, label: c.label, href: c.href, tone: c.tone, state: c.value === null ? 'none' : 'ready', value: c.value ?? undefined }));
  const items = workItems(d.mine, now);
  const mine = mineTotal(d.mine);
  const mode = layoutOf({ refused: false, workCount: mine });

  const breakdowns: Breakdown[] = [
    { id: 'plans-by-status', title: 'Plans by status', info: 'Every plan, by its status. A row opens the plans in that status.', children: <PlansByStatus d={d} /> },
    { id: 'findings', title: 'Open findings by severity', info: 'Findings that are not closed yet, by the severity they were raised with. A row opens them.', actions: <Button size="sm" variant="link" href="/bcm/findings?quick=open">All open</Button>, children: <FindingsBySeverity d={d} /> },
    { id: 'recent', title: 'Recent activity', info: 'The drills and invocations changed most recently.', actions: <Button size="sm" variant="link" href="/bcm/drills">All drills</Button>, children: <RecentActivity d={d} /> },
    { id: 'linkage', title: 'Linked to other modules', info: 'Business continuity hands drill findings to Issues / CAPA and links processes and findings to the Risk Register.', children: <Linkage d={d} /> },
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
            info="Each count opens the list it counts. Drill coverage and the recovery objectives are under Continuity posture."
            total={total !== null ? `${formatCount(total)} in total` : undefined}
            counters={band}
            narrow={narrow}
          />
        )}
        work={<DoNowCard items={items} total={mine} limit={workRowLimit(mode, narrow)} />}
        posture={<PostureCard d={d} />}
        breakdowns={breakdowns}
      />
    </div>
  );
}
