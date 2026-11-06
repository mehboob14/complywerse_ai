'use client';

// Governance > Overview, a worklist-first cockpit (option A of the Overview design lab): what needs attention across the programme as a band of counters, the
// person's own prioritised work ("Needs my action", the shared inbox narrowed to Governance, one action per row) beside a compact posture card, and the
// breakdowns below (by framework or department, the library and exceptions, the throughput). The frame is components/overview (Cockpit, CounterBand,
// WorkListCard, their rules in cockpitModel.ts and workList.ts); the Governance content is in ./_overview, its rules in overviewModel.ts and postureModel.ts.
// Seven requests feed the figures and each card loads, fails and has nothing on its own (a failed request is said where its numbers would be, never read as 0,
// and a refusal is "No access"); a person who may not read the programme scores sees that once and their own work takes the page. The eighth request is the
// posture aggregate (./_overview/postureApi.ts), the work comes from the inbox queries the top bar already holds.
// The queries, their keys and the scorecard's formula and weights are what they were: the scorecard is computed by the server
// (/governance/dashboard/documents-overview) and shared with the main dashboard under SCORECARD_QUERY_KEYS.governance.
// On the design-system kit: PageHeader variant="page", Button, Menu, SectionCard, SegmentedControl, CountRow, WorkRow, Skeleton / ErrorState / EmptyState.
import { useState } from 'react';
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
import { CounterBand, type BandCounter } from '@/components/overview/CounterBand';
import { WorkListCard } from '@/components/overview/WorkListCard';
import { layoutOf, workRowLimit } from '@/components/overview/cockpitModel';
import { useNarrow } from '@/components/overview/useNarrow';
import { workOf, type WorkFilter } from '@/components/overview/workList';
import { formatCount } from '@/lib/format';
import { useInbox } from '@/lib/inbox/inboxApi';
import { clockOf } from '@/lib/inbox/inboxView';
import { LibraryBody } from './_overview/Library';
import { PerformanceDialog, type OverviewCard } from './_overview/PerformanceDialog';
import { PostureCard } from './_overview/Posture';
import { ThroughputBody } from './_overview/Throughput';
import { GroupRows } from './_overview/Groups';
import { toFeed, refused } from './_overview/parts';
import { usePosture } from './_overview/postureApi';
import { groupsMeta, type GroupBy } from './_overview/postureModel';
import {
  ATTENTION, GOVERNANCE_SOURCES, allUnavailable, attentionTotal, counterFor, retryOverview,
  type AttentionSources, type DocumentsSummary, type SourceName, type TrendPoint,
} from './_overview/overviewModel';

const GOVERNANCE_TUNING = { configBase: '/governance/dashboard', invalidateKey: [...SCORECARD_QUERY_KEYS.governance] as unknown[] };
const GROUP_INFO = 'Documents are counted under each framework they are mapped to, or under the department they are filed under. Weakest first: the groups with the lowest share of reviews on time.';

export default function GovernanceDashboardPage() {
  const router = useRouter();
  const narrow = useNarrow();
  const [openSection, setOpenSection] = useState<OverviewSection | null>(null);
  const [perfOpen, setPerfOpen] = useState(false);
  const [filter, setFilter] = useState<WorkFilter>('all');
  const [by, setBy] = useState<GroupBy>('framework');

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
  const trends = useQuery({
    queryKey: ['governance-trends'],
    queryFn: async () => (await governanceApi.getTrends(6)).data as { created?: TrendPoint[]; published?: TrendPoint[] },
    retry: retryOverview,
  });
  const exceptions = useQuery({
    queryKey: ['governance-policy-exceptions-summary'],
    queryFn: async () => (await policyExceptionApi.getSummary()).data as { total?: number; pending_approval?: number; approved?: number; expiring_soon?: number },
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
    key: def.key, label: def.label, href: def.href, tone: def.tone,
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
  const breakdowns: Breakdown[] = [
    {
      id: 'by-group',
      title: `By ${by}`,
      info: first ? [first.notes.counting, first.notes.review_health, first.notes.needs_attention, first.notes.open_exceptions].join(' ') : GROUP_INFO,
      meta: first ? groupsMeta(first) : undefined,
      actions: (
        <SegmentedControl<GroupBy>
          label="Group by" name="posture-by" value={by} onChange={setBy}
          options={[{ value: 'framework', label: 'Framework' }, { value: 'department', label: 'Department' }]}
        />
      ),
      size: 'wide',
      children: <GroupRows query={groups} by={by} />,
    },
    {
      id: 'library',
      title: 'Library and exceptions',
      children: <LibraryBody summary={feeds.summary} scorecard={feeds.scorecard} exceptions={feeds.exceptions} />,
    },
    {
      id: 'throughput',
      title: 'Content throughput',
      info: 'Documents created and published each month, over the last six months.',
      size: 'band',
      children: <ThroughputBody feed={feeds.trends} />,
    },
  ];

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
                { key: 'attestations', label: 'Attestations', icon: FileCheck, onSelect: () => router.push('/governance/documents/attestation') },
                { key: 'statements', label: 'Statements', icon: FileText, onSelect: () => router.push('/compliance/statements') },
              ]}
            />
            <Button href="/governance/documents" variant="primary" leftIcon={<FileText aria-hidden />}>Manage Documents</Button>
          </>
        ) : (
          <>
            {/* Attestations + Statements moved here from the sidebar: they live under the Governance documents area now */}
            <Button href="/governance/documents/attestation" leftIcon={<FileCheck aria-hidden />}>Attestations</Button>
            <Button href="/compliance/statements" leftIcon={<FileText aria-hidden />}>Statements</Button>
            <Button href="/governance/documents" variant="primary" leftIcon={<FileText aria-hidden />}>Manage Documents</Button>
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
          />
        )}
        posture={(
          <PostureCard
            feed={feeds.scorecard}
            wide={mode === 'solo'}
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
