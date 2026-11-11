'use client';

// Governance > Overview, a dashboard first: six figures with their trend (the score and how it moved, what needs attention, the documents, the overdue reviews,
// the coverage, what was published), the counters that open the records, then the charts (section scores against the target, documents by status and by type, the
// throughput by month, review health and where attention sits per framework or department, what lapses when, the exceptions, the requests and actions), and under
// them what the person has to do ("Needs my action", the shared inbox narrowed to Governance, one action per row) beside the posture card (how each score is made,
// the weights) and the table of every framework or department. The frame is components/overview (Cockpit, CounterBand, WorkListCard, their rules in cockpitModel.ts and
// workList.ts) and the chart kit components/overview/charts; the Governance content is in ./_overview, its rules in overviewModel.ts, postureModel.ts and visualsModel.ts.
// Seven requests feed the figures and each card loads, fails and has nothing on its own (a failed request is said where its numbers would be, never read as 0, and
// a refusal is "No access"); a person who may not read the programme scores sees that once and their own work takes the page. The eighth request is the posture
// aggregate (./_overview/postureApi.ts), the work comes from the inbox queries the top bar already holds.
// The queries, their keys and the scorecard's formula and weights are what they were: the scorecard is computed by the server
// (/governance/dashboard/documents-overview) and shared with the main dashboard under SCORECARD_QUERY_KEYS.governance.
// On the design-system kit: PageHeader variant="page", Button, Menu, SectionCard, SegmentedControl, CountRow, WorkRow, Skeleton / ErrorState / EmptyState.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { FileCheck, FileText, Lock, RefreshCw } from 'lucide-react';
import { governanceApi, policyExceptionApi } from '@/lib/api';
import { titleFor } from '@/lib/navRegistry';
import { PageHeader } from '@/components/ui';
import { Button, IconButton, Menu, Notice, SegmentedControl, Skeleton } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { SectionDetailModal, type OverviewSection } from '@/components/dashboard/score-kit';
import { SCORECARD_QUERY_KEYS } from '@/components/dashboard/scorecard-query-keys';
import { Cockpit, SkipToWork, type Breakdown } from '@/components/overview/Cockpit';
import { Cell, ChartGrid } from '@/components/overview/charts';
import { CounterBand, type BandCounter } from '@/components/overview/CounterBand';
import { WorkListCard } from '@/components/overview/WorkListCard';
import { layoutOf, workRowLimit } from '@/components/overview/cockpitModel';
import { useNarrow } from '@/components/overview/useNarrow';
import { workOf, type WorkFilter } from '@/components/overview/workList';
import { formatCount } from '@/lib/format';
import { useInbox } from '@/lib/inbox/inboxApi';
import { clockOf } from '@/lib/inbox/inboxView';
import { ExceptionsCard, FlowCard, LapseCard, SectionScoresCard, StatusCard, ThroughputCard, TypeCard } from './_overview/Charts';
import { AttentionHeatCard, ReviewHealthCard } from './_overview/GroupCharts';
import { Hero, type HeroFeeds } from './_overview/Hero';
import { LibraryBody } from './_overview/Library';
import { PerformanceDialog, type OverviewCard } from './_overview/PerformanceDialog';
import { PostureCard } from './_overview/Posture';
import { GroupRows } from './_overview/Groups';
import { link, refused, toFeed } from './_overview/parts';
import { usePosture } from './_overview/postureApi';
import { groupsMeta, type GroupBy } from './_overview/postureModel';
import {
  ATTENTION, GOVERNANCE_SOURCES, allUnavailable, attentionTotal, counterFor, retryOverview,
  type AttentionKey, type AttentionSources, type Counter, type DocumentsSummary, type SourceName, type TrendPoint,
} from './_overview/overviewModel';
import type { ExceptionsAnswer, HeroInputs } from './_overview/visualsModel';

const GOVERNANCE_TUNING = { configBase: '/governance/dashboard', invalidateKey: [...SCORECARD_QUERY_KEYS.governance] as unknown[] };
const GROUP_INFO = 'Documents are counted under each framework they are mapped to, or under the department they are filed under. Weakest first: the groups with the lowest share of reviews on time.';

export default function GovernanceDashboardPage() {
  const router = useRouter();
  const narrow = useNarrow();
  const [openSection, setOpenSection] = useState<OverviewSection | null>(null);
  const [perfOpen, setPerfOpen] = useState(false);
  const [filter, setFilter] = useState<WorkFilter>('all');
  const [by, setBy] = useState<GroupBy>('framework');
  const now = useMemo(() => new Date(), []);              // the throughput window ends in the month the page was opened in

  const summary = useQuery({
    queryKey: ['governance-dashboard-summary'],
    queryFn: async () => (await governanceApi.getDashboardSummary()).data as DocumentsSummary,
    retry: retryOverview,
  });
  const pending = useQuery({
    queryKey: ['governance-pending-approvals'],
    queryFn: async () => (await governanceApi.getDashboardPendingApprovals()).data as { count?: number },
    retry: retryOverview,
  });
  const expiring = useQuery({
    queryKey: ['governance-expiring-soon'],
    queryFn: async () => (await governanceApi.getExpiringSoon(30)).data as { by_timeframe?: Record<string, number> },
    retry: retryOverview,
  });
  const overdue = useQuery({
    queryKey: ['governance-overdue-reviews'],
    queryFn: async () => (await governanceApi.getDashboardOverdueReviews()).data as { count?: number },
    retry: retryOverview,
  });
  // the scorecard: its failure is an error state of its own sections (it used to be swallowed into "no data", which read as zeros)
  const scorecard = useQuery({
    queryKey: [...SCORECARD_QUERY_KEYS.governance],
    queryFn: async () => (await governanceApi.getDocumentsOverview()).data as OverviewCard,
    retry: retryOverview,
  });
  // the scorecard GET no longer writes: today's score is kept for the trend by one POST per visit, after the first successful read (a failure is silent: it only costs one trend point)
  const snapshotSent = useRef(false);
  useEffect(() => {
    if (!scorecard.isSuccess || snapshotSent.current) return;
    snapshotSent.current = true;
    governanceApi.snapshotDocumentsOverview().then(undefined, () => undefined);
  }, [scorecard.isSuccess]);
  const trends = useQuery({
    queryKey: ['governance-trends'],
    queryFn: async () => (await governanceApi.getTrends(6)).data as { created?: TrendPoint[]; published?: TrendPoint[] },
    retry: retryOverview,
  });
  const exceptions = useQuery({
    queryKey: ['governance-policy-exceptions-summary'],
    queryFn: async () => (await policyExceptionApi.getSummary()).data as ExceptionsAnswer,
    retry: retryOverview,
  });

  const feeds = {
    summary: toFeed(summary), scorecard: toFeed(scorecard), pending: toFeed(pending), overdue: toFeed(overdue),
    expiring: toFeed(expiring), trends: toFeed(trends), exceptions: toFeed(exceptions),
  };
  const groups = usePosture(by);
  const { inbox, refetch: refetchInbox, fetchingSource } = useInbox({ freshOnOpen: true });       // asked again on every open, as the Needs-my-action page does: what the person did on a document page shows at once
  const work = workOf(inbox, GOVERNANCE_SOURCES);

  // the counters: the scorecard's number wins, the dedicated request stands in when it cannot answer (overviewModel.counterFor)
  const sources: AttentionSources = feeds;
  const views = ATTENTION.map((def) => ({ def, counter: counterFor(def, sources) }));
  const retryNames = (names: SourceName[]) => names.forEach((name) => feeds[name].retry());
  const counters: BandCounter[] = views.map(({ def, counter }) => ({
    key: def.key, label: def.label, href: link(def.href), tone: def.tone,
    state: counter.state, value: counter.state === 'ready' ? counter.value : undefined,
    onRetry: counter.state === 'error' && counter.retry.some((name) => canRetry(feeds[name].error)) ? () => retryNames(counter.retry) : undefined,
  }));
  const total = attentionTotal(sources);

  // no right to read the scorecard (every Governance dashboard feed shares one rule): said once, the person's own work takes the page
  const programmeRefused = refused(feeds.scorecard);
  const mode = layoutOf({ refused: programmeRefused, workCount: work.state === 'content' || work.state === 'empty' ? work.counts.all : null });

  const refreshAll = () => {
    [summary, pending, expiring, overdue, scorecard, trends, exceptions].forEach((q) => { void q.refetch(); });
    void groups.refetch();
    refetchInbox();
  };

  const first = groups.data?.pages[0];
  const groupToggle = (
    <SegmentedControl<GroupBy>
      label="Group by" name="posture-by" value={by} onChange={setBy}
      options={[{ value: 'framework', label: 'Framework' }, { value: 'department', label: 'Department' }]}
    />
  );
  const breakdowns: Breakdown[] = [
    {
      id: 'by-group',
      title: `By ${by}`,
      info: first ? [first.notes.counting, first.notes.review_health, first.notes.needs_attention, first.notes.open_exceptions].join(' ') : GROUP_INFO,
      meta: first ? groupsMeta(first) : undefined,
      actions: groupToggle,
      size: 'wide',
      children: <GroupRows query={groups} by={by} />,
    },
    {
      id: 'library',
      title: 'Classification and mappings',
      children: <LibraryBody summary={feeds.summary} scorecard={feeds.scorecard} />,
    },
  ];

  const heroInputs: HeroInputs = {
    scorecard: feeds.scorecard, summary: feeds.summary, trends: feeds.trends, total,
    counters: Object.fromEntries(views.map(({ def, counter }) => [def.key, counter])) as Partial<Record<AttentionKey, Counter>>,
    now,
  };
  const heroFeeds: HeroFeeds = {
    scorecard: feeds.scorecard, summary: feeds.summary, trends: feeds.trends, pending: feeds.pending, overdue: feeds.overdue, expiring: feeds.expiring, exceptions: feeds.exceptions,
  };
  // a zigzag of 7 and 5 columns on a wide screen, which pairs the two 5s on a tablet; the groups take half a row each, the three small cards a third
  const visuals = (
    <ChartGrid>
      <Cell span={7}><SectionScoresCard scorecard={feeds.scorecard} /></Cell>
      <Cell span={5}><TypeCard summary={feeds.summary} /></Cell>
      <Cell span={5}><StatusCard summary={feeds.summary} /></Cell>
      <Cell span={7}><ThroughputCard trends={feeds.trends} now={now} /></Cell>
      <Cell span={6}><ReviewHealthCard query={groups} by={by} onBy={setBy} /></Cell>
      <Cell span={6}><AttentionHeatCard query={groups} by={by} /></Cell>
      <Cell span={4}><LapseCard scorecard={feeds.scorecard} expiring={feeds.expiring} summary={feeds.summary} /></Cell>
      <Cell span={4}><ExceptionsCard exceptions={feeds.exceptions} /></Cell>
      <Cell span={4}><FlowCard scorecard={feeds.scorecard} /></Cell>
    </ChartGrid>
  );

  const updated = scorecard.dataUpdatedAt > 0 ? `Updated ${clockOf(scorecard.dataUpdatedAt)}` : undefined;
  return (
    <div className="flex flex-col gap-[16px]">
      <SkipToWork />
      <PageHeader
        variant="page"
        title={titleFor('/governance') ?? 'Governance Overview'}
        info="Real-time policy, framework, review, and oversight posture"
        meta={(
          <span className="inline-flex items-center gap-[2px]">
            {updated}
            <IconButton label="Refresh the overview" onClick={refreshAll}><RefreshCw aria-hidden /></IconButton>
          </span>
        )}
        actions={narrow ? (
          <>
            <Menu
              label="More"
              items={[
                { key: 'attestations', label: 'Attestations', icon: FileCheck, onSelect: () => router.push(link('/governance/documents/attestation')) },
                { key: 'statements', label: 'Statements', icon: FileText, onSelect: () => router.push(link('/compliance/statements')) },
              ]}
            />
            <Button href={link('/governance/documents')} variant="primary" leftIcon={<FileText aria-hidden />}>Manage Documents</Button>
          </>
        ) : (
          <>
            {/* Attestations + Statements moved here from the sidebar: they live under the Governance documents area now */}
            <Button href={link('/governance/documents/attestation')} leftIcon={<FileCheck aria-hidden />}>Attestations</Button>
            <Button href={link('/compliance/statements')} leftIcon={<FileText aria-hidden />}>Statements</Button>
            <Button href={link('/governance/documents')} variant="primary" leftIcon={<FileText aria-hidden />}>Manage Documents</Button>
          </>
        )}
      />

      <Cockpit
        mode={mode}
        narrow={narrow}
        refusal={(
          <Notice tone="info" icon={Lock} title="No access to the programme scores">
            Your account cannot read the Governance document library, so the programme scores are not shown. Your own work below is unaffected. Ask an administrator for library access if you need them.
          </Notice>
        )}
        hero={<Hero inputs={heroInputs} feeds={heroFeeds} />}
        visuals={visuals}
        band={(
          <CounterBand
            id="attention"
            title="Programme needs attention"
            info="Each count opens the records it counts, or the page that lists them."
            total={
              total.state === 'ready' ? `${formatCount(total.value)} in total`
                : total.state === 'loading' ? <Skeleton className="inline-block h-[14px] w-[72px] align-middle" />
                : total.state === 'error' ? 'Total unavailable' : undefined
            }
            counters={counters}
            narrow={narrow}
            failure={allUnavailable(views.map((v) => v.counter)) ? {
              title: "Couldn't load what needs attention",
              message: errorMessage(feeds.scorecard.error),
              onRetry: canRetry(feeds.scorecard.error) ? () => retryNames(['scorecard', 'pending', 'overdue', 'expiring', 'exceptions']) : undefined,
            } : undefined}
          />
        )}
        work={(
          <WorkListCard
            id="work"
            title="Needs my action"
            info="Your own requests: decisions first, then documents to acknowledge, the most urgent first. The same list as the top bar and the Needs my action page, for Governance."
            work={work}
            filter={filter}
            onFilter={setFilter}
            limit={workRowLimit(mode, narrow)}
            onRetry={(source) => refetchInbox(source)}
            fetching={fetchingSource}
            link={link}
          />
        )}
        posture={(
          <PostureCard
            feed={feeds.scorecard}
            onOpenScore={() => setPerfOpen(true)}
            onAdjust={(key) => setOpenSection(feeds.scorecard.data?.sections?.[key] ?? null)}
          />
        )}
        breakdowns={breakdowns}
      />

      <SectionDetailModal section={openSection} onClose={() => setOpenSection(null)} tuning={GOVERNANCE_TUNING} />
      <PerformanceDialog open={perfOpen} onClose={() => setPerfOpen(false)} card={feeds.scorecard.data} tuning={GOVERNANCE_TUNING} />
    </div>
  );
}
