'use client';

// The Performance Overview: where the whole programme stands, for the people who do not live in one module. A band of what needs attention across the platform (each count opens the
// records it counts), the weakest areas beside Overall readiness, then one row for every area the person can open. It never lists the person's own work (Needs my action and My
// work do) and never re-draws a module's inside (each module's Overview does): every number comes from the module's own scorecard or the model its Overview uses
// (lib/perf/moduleFeeds.ts), so this page and the module cannot disagree. The Cyber Security KPI strip sits below (CyberKpis).
// Layout: the cockpit's frame (components/overview): the band across, two parts that wrap by what each needs (work 600px, posture 340px), the breakdown under them.
import { Inbox, LayoutDashboard, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, EmptyState, IconButton, Skeleton } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { CounterBand, type BandCounter } from '@/components/overview/CounterBand';
import { useNarrow } from '@/components/overview/useNarrow';
import { usePermissions } from '@/hooks/usePermissions';
import { useInbox } from '@/lib/inbox/inboxApi';
import { clockOf } from '@/lib/inbox/inboxView';
import { titleFor } from '@/lib/navRegistry';
import { AREAS, AREA_BY_KEY, areasFor, feedsFor } from '@/lib/perf/moduleFeeds';
import { ActFirst } from './ActFirst';
import { Modules } from './Modules';
import { Posture } from './Posture';
import { Loading } from './parts';
import { bandChips, everyAreaFailed, orderRows, overallOf, rowOf, waitingText, type AreaRow } from './perfModel';
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
        <Skeleton className="h-[56px] w-full" />
        <div className="flex flex-wrap gap-[16px]">
          <Skeleton className="h-[240px] min-w-0 flex-[8_1_600px]" />
          <Skeleton className="h-[240px] min-w-0 flex-[5_1_340px]" />
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
  const retryAll = () => retryRows(rows.filter((r) => r.state === 'error' && canRetry(r.error)));
  const refreshAll = () => { feedKeys.forEach((k) => feeds[k]?.refetch()); };
  const updatedAt = Math.max(0, ...feedKeys.map((k) => feeds[k]?.updatedAt ?? 0));

  const chips = bandChips(rows);
  const counters: BandCounter[] = chips.map((c) => ({
    key: c.key, label: c.label, href: c.href, tone: c.tone, state: c.state, value: c.value,
    onRetry: c.state === 'error' && c.areaKey && canRetry(rows.find((r) => r.area.key === c.areaKey)?.error) ? () => retryArea(c.areaKey as string) : undefined,
  }));
  const firstError = rows.find((r) => r.state === 'error')?.error;

  const badge = inbox.badge;
  const waiting = waitingText(badge.kind === 'count' ? { kind: 'count', n: badge.n } : { kind: badge.kind });

  return (
    <div className="flex flex-col gap-[16px]">
      <SkipLink />
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
          <CounterBand
            id="attention"
            title="Needs attention"
            info="Overdue, lapsed and breached items across the platform. Each count is made by its own module and opens the records it counts, or the module that lists them. They are not added together: the same item can be counted by two modules."
            counters={counters}
            narrow={narrow}
            failure={everyAreaFailed(rows) ? {
              title: "Couldn't load what needs attention",
              message: errorMessage(firstError),
              onRetry: canRetry(firstError) ? retryAll : undefined,
            } : undefined}
          />
          <div className="flex flex-wrap items-start gap-[16px]">
            <div className="min-w-0 flex-[8_1_600px]"><ActFirst rows={rows} limit={narrow ? 5 : 10} onRetry={retryAll} /></div>
            <div className="min-w-0 flex-[5_1_340px]"><Posture overall={overallOf(rows)} /></div>
          </div>
          <Modules rows={rows} total={AREAS.length} onRetry={retryArea} onRetryAll={retryAll} narrow={narrow} />
        </>
      )}
    </div>
  );
}
