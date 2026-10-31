'use client';

// Governance > Overview: how the Governance module is doing at a glance. Four tiles (the performance score, documents, coverage, exceptions), everything
// that needs attention with a link to its records, the score breakdown, the posture radar and the throughput of documents.
// Seven requests feed it, and each section loads, fails and has nothing on its own (a failed request is said where its numbers would be, never read as 0):
// the tiles and cards are in ./_overview (Tiles, Attention, Breakdown, Charts), their rules in overviewModel.ts, tested there.
// The queries, their keys and the scorecard's formula and weights are what they were: the scorecard is computed by the server
// (/governance/dashboard/documents-overview) and shared with the main dashboard under SCORECARD_QUERY_KEYS.governance.
// On the design-system kit: PageHeader variant="page", Button, SectionCard, StatusPill, Skeleton / ErrorState / EmptyState.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileCheck, FileText } from 'lucide-react';
import { governanceApi, policyExceptionApi } from '@/lib/api';
import { titleFor } from '@/lib/navRegistry';
import { PageHeader } from '@/components/ui';
import { Button } from '@/components/ui/ds';
import { SectionDetailModal, type OverviewSection } from '@/components/dashboard/score-kit';
import { SCORECARD_QUERY_KEYS } from '@/components/dashboard/scorecard-query-keys';
import { AttentionCard } from './_overview/Attention';
import { PerformanceDialog, ScoreBreakdown, type OverviewCard } from './_overview/Breakdown';
import { PostureCard, ThroughputCard } from './_overview/Charts';
import { CoverageTile, DocumentsTile, ExceptionsTile, PerformanceTile } from './_overview/Tiles';
import { toFeed } from './_overview/parts';
import { retryOverview, type DocumentsSummary, type TrendPoint } from './_overview/overviewModel';

const GOVERNANCE_TUNING = { configBase: '/governance/dashboard', invalidateKey: [...SCORECARD_QUERY_KEYS.governance] as unknown[] };

export default function GovernanceDashboardPage() {
  const [openSection, setOpenSection] = useState<OverviewSection | null>(null);
  const [perfOpen, setPerfOpen] = useState(false);

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
  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title={titleFor('/governance') ?? 'Governance Overview'}
        info="Real-time policy, framework, review, and oversight posture"
        actions={(
          <>
            {/* Attestations + Statements moved here from the sidebar: they live under the Governance documents area now */}
            <Button href="/governance/documents/attestation" leftIcon={<FileCheck aria-hidden />}>Attestations</Button>
            <Button href="/compliance/statements" leftIcon={<FileText aria-hidden />}>Statements</Button>
            <Button href="/governance/documents" variant="primary" leftIcon={<FileText aria-hidden />}>Manage Documents</Button>
          </>
        )}
      />

      <div className="grid gap-[12px] sm:grid-cols-2 xl:grid-cols-4">
        <PerformanceTile feed={feeds.scorecard} onOpen={() => setPerfOpen(true)} />
        <DocumentsTile feed={feeds.summary} />
        <CoverageTile feed={feeds.scorecard} />
        <ExceptionsTile feed={feeds.exceptions} />
      </div>

      <AttentionCard feeds={feeds} />

      <ScoreBreakdown feed={feeds.scorecard} onOpenSection={setOpenSection} />

      <div className="grid items-start gap-[12px] xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <PostureCard feed={feeds.scorecard} onOpenBreakdown={() => setPerfOpen(true)} />
        <ThroughputCard feed={feeds.trends} />
      </div>

      <SectionDetailModal section={openSection} onClose={() => setOpenSection(null)} tuning={GOVERNANCE_TUNING} />
      <PerformanceDialog open={perfOpen} onClose={() => setPerfOpen(false)} card={feeds.scorecard.data} tuning={GOVERNANCE_TUNING} />
    </div>
  );
}
