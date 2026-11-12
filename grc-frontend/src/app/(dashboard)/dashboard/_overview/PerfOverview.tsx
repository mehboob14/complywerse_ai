'use client';

// The Performance Overview: where the whole programme stands, for the people who do not live in one module, as a dashboard of its posture (Overview v2: posture first, minimal text,
// everything clicks through). Four figures lead (areas at target, the one "Needs attention" tile, the Governance score with its history, Cyber KPIs on target); then Overall readiness as
// a ring beside every scored area's score against its target (each bar opens its area, the count under a name opens the records it counts); then the areas that have no score as small
// multiples in the colour of their most serious count, beside the Cyber Security KPIs; then the two histories the page has (the Governance score, the tasks); and last the person's own work,
// slim (three rows, "See all" opens Needs my action). There is no list of counts, no table and no long list: every number comes from the module's own scorecard or the model its Overview
// uses (lib/perf/moduleFeeds.ts), so this page and the module cannot disagree. Back from a module lands on the same scroll position (useReturnToPlace); nothing on this page changes what
// it shows, so there is nothing to keep in the address.
// Layout: the chart kit's 12-column grid (components/overview/charts): ring 4 + bars 8, other areas 7 + KPIs 5, histories 6 + 6, my work 12; one column on a phone in the same order, cards never folded away.
import { LayoutDashboard, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, EmptyState, IconButton, Skeleton } from '@/components/ui/ds';
import { Cell, ChartGrid } from '@/components/overview/charts';
import { MyWorkCard } from '@/components/overview/MyWorkCard';
import { useReturnToPlace } from '@/components/overview/useReturnToPlace';
import { workOf } from '@/components/overview/workList';
import { withFrom } from '@/components/shell/withFrom';
import { usePermissions } from '@/hooks/usePermissions';
import { SOURCE_DEFS, type SourceId } from '@/lib/inbox/buildInbox';
import { useInbox } from '@/lib/inbox/inboxApi';
import { clockOf } from '@/lib/inbox/inboxView';
import { titleFor } from '@/lib/navRegistry';
import { AREA_BY_KEY, areasFor, feedsFor } from '@/lib/perf/moduleFeeds';
import { CyberKpis, useKpiLive } from './CyberKpis';
import { Hero } from './Hero';
import { OtherAreas } from './OtherAreas';
import { Posture } from './Posture';
import { ScoreCard } from './ScoreBars';
import { Trends } from './Trends';
import { Loading, useSlow } from './parts';
import { orderRows, overallOf, retryable, rowOf, type AreaRow } from './perfModel';
import { usePerfFeeds } from './usePerfFeeds';

/** Every source the inbox holds: "My work" on this page is everything waiting for the person, as the Needs my action page lists it. */
const ALL_SOURCES = Object.keys(SOURCE_DEFS) as SourceId[];
const HERE = '/dashboard';

/** The first thing a keyboard reaches: past the figures to the person's own work. It shows when it has focus. */
function SkipLink() {
  return (
    <a
      href="#work"
      className="sr-only focus:not-sr-only focus:inline-flex focus:min-h-ds-control focus:items-center focus:self-start focus:rounded-ds-control focus:border focus:border-ds-border-strong focus:bg-ds-surface focus:px-[12px] focus:text-ds-body focus:font-[600] focus:text-ds-primary-text focus-visible:outline-none focus-visible:shadow-ds-ring"
    >
      Skip to my work
    </a>
  );
}

/** What the page is while the permissions load: figures, two rows of cards and the slim work card, at about their final height so nothing jumps. */
function Pending() {
  return (
    <Loading label="Loading the overview">
      <div className="flex flex-col gap-[16px]">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-[12px]">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[118px] w-full" />)}
        </div>
        <div className="flex flex-wrap gap-[16px]">
          <Skeleton className="h-[300px] min-w-0 flex-[4_1_280px]" />
          <Skeleton className="h-[300px] min-w-0 flex-[8_1_420px]" />
        </div>
        <Skeleton className="h-[140px] w-full" />
      </div>
    </Loading>
  );
}

export default function PerfOverview() {
  const { hasAnyPermission, isAdmin, isLoading: permsLoading } = usePermissions();
  const { inbox, refetch: refetchInbox, fetchingSource } = useInbox();
  const kpi = useKpiLive();

  // the areas this person may open, and one request for each feed they read
  const areas = areasFor(isAdmin, hasAnyPermission);
  const feedKeys = feedsFor(areas);
  const feeds = usePerfFeeds(feedKeys, !permsLoading);
  const rows: AreaRow[] = orderRows(areas.map((a) => rowOf(a, a.feed ? feeds[a.feed] : undefined)));

  const retryArea = (areaKey: string) => { const f = AREA_BY_KEY[areaKey]?.feed; if (f) feeds[f]?.refetch(); };
  const retryRows = (list: readonly AreaRow[]) => { new Set(list.map((r) => r.area.feed)).forEach((f) => { if (f) feeds[f]?.refetch(); }); };
  const retryAll = () => retryRows(rows.filter(retryable));
  const refreshAll = () => { feedKeys.forEach((k) => feeds[k]?.refetch()); };
  const updatedAt = Math.max(0, ...feedKeys.map((k) => feeds[k]?.updatedAt ?? 0));

  const work = workOf(inbox, ALL_SOURCES);
  const overall = overallOf(rows);
  // a person who is shown no scored area has nothing to rank and no number to average: the tiles of the other areas and their own work are the page
  const hasScored = rows.some((r) => r.area.kind === 'score');
  // every request has answered (or failed): the page is as tall as it will be, so Back can put it where it was
  const ready = !permsLoading && rows.every((r) => r.state !== 'loading') && !kpi.isPending && work.state !== 'loading';
  useReturnToPlace(ready);
  const slow = useSlow(rows.some((r) => r.state === 'loading'));

  return (
    <div className="flex flex-col gap-[16px]">
      <SkipLink />
      <PageHeader
        variant="page"
        title={titleFor('/dashboard') ?? 'Performance Overview'}
        info="How the programme is doing across the platform: where each area stands against its target, what needs attention, and your own work. Every figure and chart opens the records it counts. Your full list of tasks and approvals is in Needs my action."
        meta={updatedAt > 0 ? (
          <span className="inline-flex items-center gap-[2px]">{`Updated ${clockOf(updatedAt)}`}<IconButton label="Refresh the overview" onClick={refreshAll}><RefreshCw aria-hidden /></IconButton></span>
        ) : undefined}
      />

      {permsLoading ? <Pending /> : rows.length === 0 ? (
        <EmptyState
          kind="firstUse"
          icon={LayoutDashboard}
          title="No areas to show"
          description="Your role does not open any of the areas this page summarises. Your own tasks and approvals are in Needs my action; the menu lists what you can open."
          info="If you expected areas here, ask an administrator to check your role."
          action={<Button href="/needs-my-action" variant="primary">Needs my action</Button>}
        />
      ) : (
        <>
          <Hero rows={rows} overall={overall} governance={feeds.governance?.data} onRetry={retryArea} onRetryAll={retryAll} />
          <ChartGrid>
            {hasScored && <Cell span={4}><Posture overall={overall} /></Cell>}
            {hasScored && <Cell span={8}><ScoreCard rows={rows} onRetry={retryAll} /></Cell>}
            <Cell span={hasScored ? 7 : 12}><OtherAreas rows={rows} onRetry={retryArea} /></Cell>
            <Cell span={hasScored ? 5 : 12}><CyberKpis /></Cell>
            <Trends rows={rows} payloads={{ governance: feeds.governance?.data, tasks: feeds.tasks?.data }} onRetry={retryArea} />
          </ChartGrid>
          {slow && <p className="text-ds-label text-ds-fg-muted">Still loading. This is taking longer than usual.</p>}
          <MyWorkCard work={work} onRetry={(source) => refetchInbox(source)} fetching={fetchingSource} link={(href) => withFrom(href, HERE)} />
        </>
      )}
    </div>
  );
}
