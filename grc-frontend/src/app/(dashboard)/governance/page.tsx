'use client';

import { useQuery } from '@tanstack/react-query';
import { governanceApi, policyExceptionApi, committeeApi, regulatoryApi, attestationApi } from '@/lib/api';
import { FileText, FileCheck } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ResponsiveContainer,
} from 'recharts';
import Link from 'next/link';

// Charter tone: emerald ≥80, amber ≥60, else rose. Single sanctioned status ramp.
function toneColor(score: number): string {
  return score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#f43f5e';
}

function TrendBarChart({ data }: { data: { month: string; created: number; published: number }[] }) {
  const chartData = data.slice(-6).map((item) => ({
    month: new Date(item.month + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
    Created: item.created,
    Published: item.published,
  }));
  if (!chartData.length) {
    return <div className="flex h-[150px] items-center justify-center text-xs text-slate-400">No trend data yet</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={150}>
      <BarChart data={chartData} barSize={13} barCategoryGap="28%">
        <CartesianGrid strokeDasharray="2 2" stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={24} allowDecimals={false} />
        <RTooltip
          contentStyle={{ fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', color: '#1e293b' }}
        />
        <Bar dataKey="Created" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
        <Bar dataKey="Published" fill="#1ed4b0" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function GovernanceDashboardPage() {
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['governance-dashboard-summary'],
    queryFn: async () => {
      const response = await governanceApi.getDashboardSummary();
      return response.data;
    },
  });

  const { data: pendingApprovals, isLoading: pendingLoading } = useQuery({
    queryKey: ['governance-pending-approvals'],
    queryFn: async () => {
      const response = await governanceApi.getDashboardPendingApprovals();
      return response.data;
    },
  });

  const { data: expiringSoon, isLoading: expiringLoading } = useQuery({
    queryKey: ['governance-expiring-soon'],
    queryFn: async () => {
      const response = await governanceApi.getExpiringSoon(30);
      return response.data;
    },
  });

  const { data: overdueReviews, isLoading: overdueLoading } = useQuery({
    queryKey: ['governance-overdue-reviews'],
    queryFn: async () => {
      const response = await governanceApi.getDashboardOverdueReviews();
      return response.data;
    },
  });

  const { data: recentlyPublished, isLoading: recentLoading } = useQuery({
    queryKey: ['governance-recently-published'],
    queryFn: async () => {
      const response = await governanceApi.getRecentlyPublished(5);
      return response.data;
    },
  });

  const { data: reviewStats, isLoading: reviewStatsLoading } = useQuery({
    queryKey: ['governance-review-statistics'],
    queryFn: async () => {
      const response = await governanceApi.getReviewStatistics();
      return response.data;
    },
  });

  const { data: complianceCoverage, isLoading: complianceLoading } = useQuery({
    queryKey: ['governance-compliance-coverage'],
    queryFn: async () => {
      const response = await governanceApi.getComplianceCoverage();
      return response.data;
    },
  });

  const { data: trends, isLoading: trendsLoading } = useQuery({
    queryKey: ['governance-trends'],
    queryFn: async () => {
      const response = await governanceApi.getTrends(6);
      return response.data;
    },
  });

  const { data: exceptionSummary, isLoading: exceptionLoading } = useQuery({
    queryKey: ['governance-policy-exceptions-summary'],
    queryFn: async () => {
      const response = await policyExceptionApi.getSummary();
      return response.data as {
        total: number;
        pending_approval: number;
        approved: number;
        expiring_soon: number;
      };
    },
  });

  const { data: workflowDashboard, isLoading: workflowStatsLoading } = useQuery({
    queryKey: ['governance-workflow-dashboard-overview'],
    queryFn: async () => {
      try {
        const response = await governanceApi.getWorkflowDashboard();
        return response.data as {
          pending_my_approval: number;
          pending_all: number;
          overdue: number;
          approved_today: number;
          rejected_today: number;
          documents_awaiting_approval: number;
        };
      } catch {
        return null;
      }
    },
  });

  const { data: committeeDashboard, isLoading: committeeLoading } = useQuery({
    queryKey: ['governance-committee-dashboard-overview'],
    queryFn: async () => {
      try {
        const response = await committeeApi.getDashboard();
        return response.data as {
          total_committees: number;
          upcoming_meetings: number;
          open_actions: number;
          overdue_actions: number;
        };
      } catch {
        return null;
      }
    },
  });

  const { data: regulatoryDashboard, isLoading: regulatoryLoading } = useQuery({
    queryKey: ['governance-regulatory-dashboard-overview'],
    queryFn: async () => {
      try {
        const response = await regulatoryApi.getDashboard();
        return response.data as {
          total_changes: number;
          by_status: Record<string, number>;
          by_priority: Record<string, number>;
          by_source: Record<string, number>;
          gaps_identified: number;
          changes_this_month: number;
          pending_assessments: number;
        };
      } catch {
        return null;
      }
    },
  });

  const { data: attestationDashboard, isLoading: attestationLoading } = useQuery({
    queryKey: ['governance-attestation-dashboard-overview'],
    queryFn: async () => {
      try {
        const response = await attestationApi.getDashboard();
        return response.data as {
          total_campaigns: number;
          pending_attestations: number;
          overdue_attestations: number;
          completion_rate: number;
        };
      } catch {
        return null;
      }
    },
  });

  const { data: complianceByFramework, isLoading: frameworkLoading } = useQuery({
    queryKey: ['governance-compliance-framework-overview'],
    queryFn: async () => {
      try {
        const response = await governanceApi.getComplianceByFramework();
        return response.data as {
          frameworks?: Array<{
            framework_id: number;
            framework_name: string;
            compliance_percentage: number;
            fully_compliant?: number;
            total_clauses?: number;
          }>;
        };
      } catch {
        return null;
      }
    },
  });

  const { data: openGapsSummary, isLoading: gapsLoading } = useQuery({
    queryKey: ['governance-open-gaps-overview'],
    queryFn: async () => {
      try {
        const response = await governanceApi.getOpenGapsSummary();
        return response.data as {
          total_open_gaps: number;
          by_severity?: Record<string, number>;
          aging_analysis?: Record<string, number>;
        };
      } catch {
        return null;
      }
    },
  });

  const isLoading =
    summaryLoading ||
    pendingLoading ||
    expiringLoading ||
    overdueLoading ||
    recentLoading ||
    reviewStatsLoading ||
    complianceLoading ||
    trendsLoading ||
    exceptionLoading ||
    workflowStatsLoading ||
    committeeLoading ||
    regulatoryLoading ||
    attestationLoading ||
    frameworkLoading ||
    gapsLoading;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div>
          <div className="skeleton h-6 w-56 mb-1.5" />
          <div className="skeleton h-4 w-80" />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="skeleton h-3 w-20 mb-3" />
              <div className="skeleton h-7 w-14 mb-2" />
              <div className="skeleton h-3 w-24" />
            </div>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-[7fr_5fr]">
          <div className="skeleton h-72 rounded-xl" />
          <div className="skeleton h-72 rounded-xl" />
        </div>
      </div>
    );
  }

  // ---- Derived metrics (unchanged data flow; only presentation reworked) ----
  const totalDocuments = summary?.total_documents || 0;
  const byStatus = summary?.by_status || {};
  const publishedCount = byStatus['published'] || 0;
  const pendingCount = pendingApprovals?.count || 0;
  const expiringCount = expiringSoon?.by_timeframe?.['30_days'] || 0;
  const overdueCount = overdueReviews?.count || 0;
  const reviewsDueThisMonth = reviewStats?.due_this_month || 0;
  const complianceRate = complianceCoverage?.overall_coverage_percent || 0;

  const publishedPct = totalDocuments > 0 ? Math.round((publishedCount / totalDocuments) * 100) : 0;
  const exceptionTotal = exceptionSummary?.total || 0;
  const exceptionAttentionCount = (exceptionSummary?.pending_approval || 0) + (exceptionSummary?.expiring_soon || 0);
  const exceptionAttentionPct = exceptionTotal > 0 ? Math.round((exceptionAttentionCount / exceptionTotal) * 100) : 0;
  const reviewHealthScore = reviewsDueThisMonth > 0 ? Math.max(0, 100 - Math.round((overdueCount / reviewsDueThisMonth) * 100)) : overdueCount > 0 ? 0 : 100;
  const approvalHealthScore = totalDocuments > 0 ? Math.max(0, 100 - Math.round((pendingCount / totalDocuments) * 100)) : 100;
  const freshnessScore = totalDocuments > 0 ? Math.max(0, 100 - Math.round((expiringCount / totalDocuments) * 100)) : 100;

  const workflowPendingAll = workflowDashboard?.pending_all || pendingCount;
  const overdueActions = committeeDashboard?.overdue_actions || 0;
  const regulatoryChanges = regulatoryDashboard?.total_changes || 0;
  const regulatoryPendingAssessments = regulatoryDashboard?.pending_assessments || 0;
  const regulatoryGaps = regulatoryDashboard?.gaps_identified || 0;
  const attestationCompletion = Number(attestationDashboard?.completion_rate || 0);
  const attestationOverdue = attestationDashboard?.overdue_attestations || 0;
  const openGapsTotal = openGapsSummary?.total_open_gaps || 0;
  const gapSeverity: Record<string, number> = openGapsSummary?.by_severity || {};

  const governanceHealthScore = Math.round(
    publishedPct * 0.22 +
    Math.round(complianceRate) * 0.24 +
    reviewHealthScore * 0.18 +
    approvalHealthScore * 0.14 +
    attestationCompletion * 0.12 +
    (exceptionTotal > 0 ? Math.max(0, 100 - exceptionAttentionPct) : 100) * 0.05 +
    (regulatoryChanges > 0
      ? Math.max(0, 100 - Math.round(((regulatoryPendingAssessments + regulatoryGaps) / Math.max(1, regulatoryChanges)) * 100))
      : 100) * 0.05
  );

  // Half-gauge arc length (π·r, r=82) → dash for the score.
  const gaugeLen = 258;
  const gaugeDash = Math.max(0, Math.min(gaugeLen, Math.round((governanceHealthScore / 100) * gaugeLen)));

  const signalTiles = [
    { label: 'Publishing', value: publishedPct },
    { label: 'Reviews', value: reviewHealthScore },
    { label: 'Approvals', value: approvalHealthScore },
    { label: 'Attestations', value: Math.round(attestationCompletion) },
  ];

  const postureBars = [
    { metric: 'Publishing', score: publishedPct },
    { metric: 'Coverage', score: Math.round(complianceRate) },
    { metric: 'Reviews', score: reviewHealthScore },
    { metric: 'Approvals', score: approvalHealthScore },
    { metric: 'Freshness', score: freshnessScore },
    { metric: 'Exceptions', score: exceptionTotal > 0 ? Math.max(0, 100 - exceptionAttentionPct) : 100 },
  ];

  const statusSplit = [
    { label: 'Published', value: byStatus['published'] || 0, color: '#10b981' },
    { label: 'Draft', value: byStatus['draft'] || 0, color: '#cbd5e1' },
    { label: 'In review', value: byStatus['pending_review'] || 0, color: '#3ddfc2' },
    { label: 'Approval', value: byStatus['pending_approval'] || 0, color: '#f59e0b' },
    { label: 'Expired', value: byStatus['expired'] || 0, color: '#f43f5e' },
  ];
  const statusTotal = statusSplit.reduce((sum, s) => sum + s.value, 0) || 1;

  const overdueTotal = overdueCount + attestationOverdue + overdueActions;

  const attentionItems = [
    { title: 'Overdue reviews', sub: 'past review date', value: overdueCount, tone: 'rose', link: 'Reviews', href: '/governance/reviews' },
    { title: 'Overdue attestations', sub: 'campaign deadline passed', value: attestationOverdue, tone: 'rose', link: 'Attestations', href: '/governance/attestations' },
    { title: 'Overdue committee actions', sub: 'follow-ups past due', value: overdueActions, tone: 'rose', link: 'Committees', href: '/governance/committees/actions' },
    { title: 'Pending approvals', sub: 'awaiting sign-off', value: workflowPendingAll, tone: 'amber', link: 'Approvals', href: '/governance/approvals' },
    { title: 'Expiring ≤ 30 days', sub: 'documents to renew', value: expiringCount, tone: 'amber', link: 'Documents', href: '/governance/documents' },
    {
      title: 'Open framework gaps',
      sub: `${gapSeverity.critical || 0} critical · ${gapSeverity.high || 0} high`,
      value: openGapsTotal,
      tone: 'amber',
      link: 'Mappings',
      href: '/governance/mappings',
    },
  ];

  const trendData: { month: string; created: number; published: number }[] = (trends?.created || []).map(
    (item: { month: string; count: number }, idx: number) => ({
      month: item.month,
      created: item.count,
      published: trends?.published?.[idx]?.count || 0,
    })
  );
  const createdTotal = trendData.reduce((sum, item) => sum + item.created, 0);
  const publishedTotalInPeriod = trendData.reduce((sum, item) => sum + item.published, 0);
  const publishRate = createdTotal > 0 ? Math.round((publishedTotalInPeriod / createdTotal) * 100) : 0;

  const frameworkItems = ((complianceByFramework?.frameworks || []) as Array<any>).slice(0, 6).map((fw) => ({
    label: fw.framework_name,
    value: Number(fw.compliance_percentage || 0),
    meta: `${fw.fully_compliant || 0}/${fw.total_clauses || 0} clauses`,
  }));
  const frameworkCount = ((complianceByFramework?.frameworks || []) as Array<any>).length;
  const strongFrameworkCount = ((complianceByFramework?.frameworks || []) as Array<any>).filter((fw) => Number(fw.compliance_percentage || 0) >= 80).length;

  const kpis = [
    { label: 'Documents', value: totalDocuments, sub: 'governed portfolio', tone: 'text-primary-700' },
    { label: 'Published', value: publishedCount, sub: `${publishedPct}% live`, tone: 'text-emerald-600' },
    { label: 'Pending flow', value: workflowPendingAll, sub: 'reviews & approvals', tone: 'text-amber-600' },
    { label: 'Overdue reviews', value: overdueCount, sub: 'past review date', tone: 'text-rose-600' },
    { label: 'Coverage', value: `${Math.round(complianceRate)}%`, sub: 'framework mapping', tone: 'text-primary-700' },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Governance Overview</h1>
          <p className="text-sm text-slate-500">Real-time policy, framework, review &amp; oversight posture</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/governance/attestations"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            <FileCheck size={15} strokeWidth={1.75} />
            Attestations
          </Link>
          <Link
            href="/compliance/statements"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            <FileText size={15} strokeWidth={1.75} />
            Statements
          </Link>
          <Link href="/governance/documents" className="btn-primary">
            <FileText size={15} strokeWidth={1.75} />
            Manage Documents
          </Link>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{kpi.label}</p>
            <p className={`mt-2 text-2xl font-bold leading-none ${kpi.tone}`}>{kpi.value}</p>
            <p className="mt-1.5 text-[11px] text-slate-400">{kpi.sub}</p>
          </div>
        ))}
      </div>

      {/* Health + Attention */}
      <div className="grid gap-4 lg:grid-cols-[7fr_5fr]">
        {/* Governance Health */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-slate-800">Governance Health</h2>
            <p className="text-[11px] text-slate-500">Blended posture vs 85% target</p>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <div className="shrink-0">
              <div className="relative mx-auto" style={{ width: 200, height: 118 }}>
                <svg viewBox="0 0 200 118" width="200" height="118">
                  <path d="M18 108 A82 82 0 0 1 182 108" fill="none" stroke="#f1f5f9" strokeWidth="14" strokeLinecap="round" />
                  <path
                    d="M18 108 A82 82 0 0 1 182 108"
                    fill="none"
                    stroke="#1ed4b0"
                    strokeWidth="14"
                    strokeLinecap="round"
                    strokeDasharray={`${gaugeDash} ${gaugeLen}`}
                  />
                </svg>
                <div className="absolute inset-x-0 bottom-0.5 text-center">
                  <span className="block text-[32px] font-bold leading-none text-slate-900">{governanceHealthScore}%</span>
                  <span className="text-[11px] text-slate-500">overall health</span>
                </div>
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                {signalTiles.map((s) => (
                  <div key={s.label} className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{s.label}</p>
                    <p className="mt-0.5 text-[15px] font-semibold text-slate-900">{s.value}%</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="min-w-[230px] flex-1">
              <p className="mb-2 text-[11px] text-slate-400">Posture vs 85% target</p>
              {postureBars.map((b) => (
                <div key={b.metric} className="mb-2.5 last:mb-0">
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="font-medium text-slate-700">{b.metric}</span>
                    <span className="text-slate-500">{b.score}%</span>
                  </div>
                  <div className="h-[7px] overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, b.score)}%`, backgroundColor: toneColor(b.score) }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-4 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Document status · {totalDocuments} total</div>
          <div className="mt-1.5 flex h-[11px] overflow-hidden rounded-full bg-slate-100">
            {statusSplit.map((s) =>
              s.value > 0 ? (
                <div key={s.label} style={{ width: `${(s.value / statusTotal) * 100}%`, backgroundColor: s.color }} title={`${s.label} ${s.value}`} />
              ) : null
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {statusSplit.map((s) => (
              <span key={s.label} className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                {s.label} {s.value}
              </span>
            ))}
          </div>
        </div>

        {/* Needs attention now */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Needs attention now</h2>
              <p className="text-[11px] text-slate-500">Ranked by urgency</p>
            </div>
            <span className="inline-flex items-center rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-700">{overdueTotal} overdue</span>
          </div>
          {attentionItems.map((a) => (
            <div key={a.title} className="flex items-center gap-3 border-b border-slate-100 py-2.5 last:border-b-0">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: a.tone === 'rose' ? '#f43f5e' : '#f59e0b' }} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-slate-900">{a.title}</div>
                <div className="text-[11px] text-slate-400">{a.sub}</div>
              </div>
              <div className="text-lg font-bold tabular-nums text-slate-900">{a.value}</div>
              <Link href={a.href} className="whitespace-nowrap text-[11px] font-medium text-primary-700 hover:underline">
                {a.link} →
              </Link>
            </div>
          ))}
        </div>
      </div>

      {/* Framework coverage + Throughput */}
      <div className="grid gap-4 lg:grid-cols-[7fr_5fr]">
        {/* Framework coverage */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Framework coverage</h2>
              <p className="text-[11px] text-slate-500">Mapped compliance by framework</p>
            </div>
            <span className="text-[11px] text-slate-400">{strongFrameworkCount} of {frameworkCount} ≥ 80%</span>
          </div>
          {frameworkItems.length > 0 ? (
            frameworkItems.map((f) => (
              <div key={f.label} className="mb-2.5 last:mb-0">
                <div className="mb-1 flex justify-between text-xs">
                  <span className="font-medium text-slate-700">{f.label}</span>
                  <span className="text-slate-500">{f.value}% · {f.meta}</span>
                </div>
                <div className="h-[7px] overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, f.value)}%`, backgroundColor: toneColor(f.value) }} />
                </div>
              </div>
            ))
          ) : (
            <div className="flex h-[180px] items-center justify-center text-xs text-slate-400">No framework mapping results yet</div>
          )}
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-[11px] font-medium text-rose-700">Critical {gapSeverity.critical || 0}</span>
            <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-700">High {gapSeverity.high || 0}</span>
            <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-700">Medium {gapSeverity.medium || 0}</span>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600">Low {gapSeverity.low || 0}</span>
          </div>
        </div>

        {/* Content throughput */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Content throughput</h2>
              <p className="text-[11px] text-slate-500">Created vs published · last 6 months</p>
            </div>
            <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">{publishRate}% live rate</span>
          </div>
          <TrendBarChart data={trendData} />
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-center">
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Created</p>
              <p className="text-sm font-semibold text-slate-900">{createdTotal}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-center">
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Published</p>
              <p className="text-sm font-semibold text-emerald-600">{publishedTotalInPeriod}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-center">
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Live rate</p>
              <p className="text-sm font-semibold text-primary-700">{publishRate}%</p>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#1ed4b0' }} />Published</span>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#cbd5e1' }} />Created</span>
          </div>
        </div>
      </div>
    </div>
  );
}
