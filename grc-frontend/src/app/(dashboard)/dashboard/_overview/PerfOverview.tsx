'use client';

// The Performance Overview: where the whole programme stands, for the people who do not live in one module, as a dashboard. Four figures lead (areas at target, areas needing attention,
// the Governance score with its history, Cyber KPIs on target), then Overall readiness as a ring beside every scored area's score against its target, the counts that need attention
// ranked, the sections furthest below their target, the two histories the page has (the Governance score, the tasks), and under them one row for every area the person can open
// (the table that carries every number in words). Each bar and each count opens the records it counts. It never lists the person's own work (Needs my action and My work do) and never
// re-draws a module's inside (each module's Overview does): every number comes from the module's own scorecard or the model its Overview uses (lib/perf/moduleFeeds.ts), so this page and
// the module cannot disagree. The Cyber Security KPI strip sits below (CyberKpis).
// Layout: the chart kit's 12-column grid (components/overview/charts): ring 4 + bars 8, attention 6 + weakest 6, histories 6 + 6; one column on a phone, cards never folded away.
import { Inbox, LayoutDashboard, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, EmptyState, IconButton, Skeleton } from '@/components/ui/ds';
import { Cell, ChartGrid } from '@/components/overview/charts';
import { useNarrow } from '@/components/overview/useNarrow';
import { usePermissions } from '@/hooks/usePermissions';
import { useInbox } from '@/lib/inbox/inboxApi';
import { clockOf } from '@/lib/inbox/inboxView';
import { titleFor } from '@/lib/navRegistry';
import { AREAS, AREA_BY_KEY, areasFor, feedsFor } from '@/lib/perf/moduleFeeds';
import { ActFirst } from './ActFirst';
import { Attention } from './Attention';
import { Hero } from './Hero';
import { Modules } from './Modules';
import { Posture } from './Posture';
import { ScoreCard } from './ScoreBars';
import { Trends } from './Trends';
import { Loading } from './parts';
import { orderRows, overallOf, retryable, rowOf, waitingOf, waitingText, type AreaRow } from './perfModel';
import { usePerfFeeds } from './usePerfFeeds';

/** The first thing a keyboard reaches: past the counters to the list of areas to act on. It shows when it has focus. */
function SkipLink() {
  return (
    <a
      href="#work"
      className="sr-only focus:not-sr-only focus:inline-flex focus:min-h-ds-control focus:items-center focus:self-start focus:rounded-ds-control focus:border focus:border-ds-border-strong focus:bg-ds-surface focus:px-[12px] focus:text-ds-body focus:font-[600] focus:text-ds-primary-text focus-visible:outline-none focus-visible:shadow-ds-ring"
    >
      Skip to where to act first
    </a>
  );
}

function Pending() {
  return (
    <Loading label="Loading the overview">
      <div className="flex flex-col gap-[16px]">
        <Skeleton className="h-[96px] w-full" />
        <div className="flex flex-wrap gap-[16px]">
          <Skeleton className="h-[300px] min-w-0 flex-[4_1_280px]" />
          <Skeleton className="h-[300px] min-w-0 flex-[8_1_420px]" />
        </div>
      </div>
    </Loading>
  );
}

export default function PerfOverview() {
  const narrow = useNarrow();
  const { hasAnyPermission, isAdmin, isLoading: permsLoading } = usePermissions();
  const { inbox } = useInbox();

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

  const waiting = waitingText(waitingOf(inbox));
  const overall = overallOf(rows);
  // a person who is shown no scored area has nothing to rank and no number to average: the counts and the rows are the page
  const hasScored = rows.some((r) => r.area.kind === 'score');

  return (
    <div className="flex flex-col gap-[16px]">
      {hasScored && <SkipLink />}
      <PageHeader
        variant="page"
        title={titleFor('/dashboard') ?? 'Performance Overview'}
        info="How the programme is doing across the platform: what needs attention, the areas furthest from their target, and one row for every area you can open. Your own tasks and approvals are in Needs my action."
        meta={updatedAt > 0 ? (
          <span className="inline-flex items-center gap-[2px]">{`Updated ${clockOf(updatedAt)}`}<IconButton label="Refresh the overview" onClick={refreshAll}><RefreshCw aria-hidden /></IconButton></span>
        ) : undefined}
        actions={<Button href="/needs-my-action" variant="primary" leftIcon={<Inbox aria-hidden />}>{waiting}</Button>}
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
            <Cell span={hasScored ? 6 : 12}><Attention rows={rows} limit={narrow ? 6 : 12} onRetry={retryAll} /></Cell>
            {hasScored && <Cell span={6}><ActFirst rows={rows} limit={narrow ? 5 : 10} onRetry={retryAll} /></Cell>}
          </ChartGrid>
          <Trends rows={rows} payloads={{ governance: feeds.governance?.data, tasks: feeds.tasks?.data }} onRetry={retryArea} />
          <Modules rows={rows} total={AREAS.length} onRetry={retryArea} onRetryAll={retryAll} narrow={narrow} />
        </>
      )}
    </div>
  );
}
