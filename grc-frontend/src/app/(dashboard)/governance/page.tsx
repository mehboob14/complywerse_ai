'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { governanceApi, policyExceptionApi } from '@/lib/api';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import {
  type OverviewMetric,
  type OverviewSection,
  scoreTone,
  scoreBand,
  ScoreRing,
  MetricRow,
  SectionDetailModal,
} from '@/components/dashboard/score-kit';
import ScoreBreakdownCard, { scoreCardRow } from '@/components/dashboard/ScoreBreakdownCard';
import { SectionWeightTuner } from '@/components/dashboard/score-tuning';
import {
  FileText,
  AlertTriangle,
  FileCheck,
  Shield,
  Layers,
  TrendingUp,
  SlidersHorizontal,
  ChevronDown,
} from 'lucide-react';

import { SCORECARD_QUERY_KEYS } from '@/components/dashboard/scorecard-query-keys';

const GOVERNANCE_TUNING = { configBase: '/governance/dashboard', invalidateKey: [...SCORECARD_QUERY_KEYS.governance] as unknown[] };
import {
  Tooltip as RTooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  RadarChart as RRadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
} from 'recharts';
import Link from 'next/link';

type DocsOverviewPayload = {
  as_of: string;
  sections: Record<string, OverviewSection>;
  attention_queue: Record<string, number>;
  performance: {
    score: number | null;
    grade: string | null;
    formula?: string;
    components: Array<{ key: string; label: string; score: number | null; weight: number; target: number }>;
  };
};

function GovernanceHealthRadar({
  data,
}: {
  data: {
    metric: string;
    score: number;
    target: number;
    formula?: string;
    numerator?: number;
    denominator?: number;
    weight?: number;
  }[];
}) {
  if (!data.length) {
    return <div className="flex h-[220px] items-center justify-center text-xs cw-text-muted">No health data yet</div>;
  }

  return (
    <div className="flex items-center gap-5">
      <ResponsiveContainer width="58%" height={220}>
        <RRadarChart data={data}>
          <PolarGrid stroke="#e2e8f0" />
          <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11, fill: '#64748b' }} />
          <PolarRadiusAxis axisLine={false} tick={false} domain={[0, 100]} />
          <Radar name="Current" dataKey="score" stroke="#2563eb" fill="#60a5fa" fillOpacity={0.45} strokeWidth={2} />
          <Radar name="Target" dataKey="target" stroke="#10b981" fill="#bbf7d0" fillOpacity={0.18} strokeWidth={2} />
          <RTooltip
            contentStyle={{ fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', color: '#1e293b' }}
          />
        </RRadarChart>
      </ResponsiveContainer>
      <div className="flex-1 space-y-2">
        {data.map((item) => {
          const tone = item.score >= 80 ? 'bg-emerald-500' : item.score >= 60 ? 'bg-amber-500' : 'bg-rose-500';
          return (
            <div key={item.metric} title={item.formula ? `Formula: ${item.formula}` : undefined}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium text-slate-700">{item.metric}</span>
                <span className="text-slate-500">{item.score}%</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100">
                <div className={`${tone} h-2 rounded-full`} style={{ width: `${item.score}%` }} />
              </div>
              {item.denominator != null && item.weight != null && (
                <p className="mt-0.5 text-[10px] text-slate-400">
                  {item.numerator}/{item.denominator} · weight {Math.round(item.weight * 100)}% · target {item.target}%
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TrendAreaChart({ data }: { data: { month: string; created: number; published: number }[] }) {
  const chartData = data.slice(-6).map((item) => ({
    month: new Date(item.month + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
    Created: item.created,
    Published: item.published,
  }));
  if (!chartData.length) {
    return (
      <div className="flex h-full items-center justify-center text-xs cw-text-muted">No trend data yet</div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={chartData} margin={{ top: 8, right: 12, left: -14, bottom: 0 }}>
        <defs>
          <linearGradient id="trendCreated" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="trendPublished" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="2 2" stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
        <RTooltip
          contentStyle={{ fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', color: '#1e293b' }}
        />
        <Area type="monotone" dataKey="Created" stroke="#3b82f6" strokeWidth={2}
              fill="url(#trendCreated)" dot={{ r: 3, strokeWidth: 2, fill: '#fff' }} />
        <Area type="monotone" dataKey="Published" stroke="#10b981" strokeWidth={2}
              fill="url(#trendPublished)" dot={{ r: 3, strokeWidth: 2, fill: '#fff' }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export default function GovernanceDashboardPage() {
  const [openSection, setOpenSection] = useState<OverviewSection | null>(null);
  // breakdown is opt-in, same as the IT-Assets inventory scorecard
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [perfOpen, setPerfOpen] = useState(false);
  const [tuning, setTuning] = useState(false);

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

  const { data: docsOverview, isLoading: docsOverviewLoading } = useQuery({
    queryKey: [...SCORECARD_QUERY_KEYS.governance],
    queryFn: async () => {
      try {
        const response = await governanceApi.getDocumentsOverview();
        return response.data as DocsOverviewPayload;
      } catch {
        return null;
      }
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

  const isLoading =
    summaryLoading ||
    pendingLoading ||
    expiringLoading ||
    overdueLoading ||
    docsOverviewLoading ||
    trendsLoading ||
    exceptionLoading;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="page-header">
          <div className="skeleton h-5 w-56 mb-1" />
          <div className="skeleton h-4 w-80" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="stat-card">
              <div className="skeleton h-8 w-8 rounded-lg mb-3" />
              <div className="skeleton h-6 w-16 mb-1" />
              <div className="skeleton h-3 w-24" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const totalDocuments = summary?.total_documents || 0;
  const byStatus = summary?.by_status || {};
  const publishedCount = byStatus['published'] || 0;
  const pendingCount = pendingApprovals?.count || 0;
  const expiringCount = expiringSoon?.by_timeframe?.['30_days'] || 0;
  const overdueCount = overdueReviews?.count || 0;
  const overviewSections = docsOverview?.sections;
  const sectionMetric = (sectionKey: string, metricKey: string): OverviewMetric | undefined =>
    overviewSections?.[sectionKey]?.metrics?.find((m) => m.key === metricKey);
  const complianceRate = sectionMetric('mappings', 'document_coverage')?.score ?? 0;

  // Every score, weight, target, and formula is computed server-side by
  // /governance/dashboard/documents-overview. The radar plots the SECTION
  // scores (one spoke per module area); each section card below shows the
  // area's own metrics with numerator/denominator and formula tooltips.
  const perfComponents = docsOverview?.performance?.components || [];
  const publishedPct = Math.round(
    sectionMetric('documents', 'publishing_rate')?.score ??
    (totalDocuments > 0 ? (publishedCount / totalDocuments) * 100 : 0)
  );
  const exceptionAttentionCount =
    docsOverview?.attention_queue?.exceptions_attention ??
    ((exceptionSummary?.pending_approval || 0) + (exceptionSummary?.expiring_soon || 0));

  const healthRadarData = perfComponents.map((c) => ({
    metric: c.label,
    score: Math.round(c.score ?? 0),
    target: c.target,
    weight: c.weight,
  }));

  const sectionOrder = ['documents', 'mappings', 'approvals', 'reviews', 'exceptions', 'attestations', 'committees', 'kris', 'kpi', 'projects'];
  const sectionCards = sectionOrder
    .map((key) => overviewSections?.[key])
    .filter((s): s is OverviewSection => Boolean(s));

  const attentionQueue = docsOverview?.attention_queue;
  const attentionItems = [
    { label: 'Documents awaiting approval', value: attentionQueue?.documents_awaiting_approval ?? pendingCount, color: '#f59e0b', href: '/governance/approvals' },
    { label: 'Overdue reviews', value: attentionQueue?.overdue_reviews ?? overdueCount, color: '#ef4444', href: '/governance/reviews' },
    { label: 'Documents expiring in 30 days', value: attentionQueue?.expiring_documents_30d ?? expiringCount, color: '#f97316', href: '/governance/documents' },
    { label: 'Exceptions pending or expiring', value: attentionQueue?.exceptions_attention ?? exceptionAttentionCount, color: '#8b5cf6', href: '/governance/exceptions' },
    { label: 'Open gap findings', value: attentionQueue?.open_gaps ?? 0, color: '#64748b', href: '/governance/documents' },
    { label: 'Overdue attestations', value: attentionQueue?.overdue_attestations ?? 0, color: '#0ea5e9', href: '/governance/attestations' },
    { label: 'Overdue committee actions', value: attentionQueue?.overdue_actions ?? 0, color: '#d946ef', href: '/governance/committees/actions' },
    { label: 'Breached KRIs', value: attentionQueue?.red_kris ?? 0, color: '#14b8a6', href: '/erm/kris' },
  ];

  const trendData = (trends?.created || []).map((item: { month: string; count: number }, idx: number) => ({
    month: item.month,
    created: item.count,
    published: trends?.published?.[idx]?.count || 0,
  }));

  const createdTotal = trendData.reduce((sum: number, item: { created: number }) => sum + item.created, 0);
  const publishedTotalInPeriod = trendData.reduce((sum: number, item: { published: number }) => sum + item.published, 0);
  const publishRate = createdTotal > 0 ? Math.round((publishedTotalInPeriod / createdTotal) * 100) : 0;


  const governanceHealthScore = Math.round(docsOverview?.performance?.score ?? 0);
  const governanceHealthGrade = docsOverview?.performance?.grade ?? null;


  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-sm font-semibold text-slate-900">Governance Overview</h1>
          <p className="text-xs text-slate-500">Real-time policy, framework, review, and oversight posture</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Attestations + Statements moved here from the sidebar — they live
              under the Governance documents area now. */}
          <Link href="/governance/documents/attestation" className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50">
            <FileCheck size={14} />
            Attestations
          </Link>
          <Link href="/compliance/statements" className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50">
            <FileText size={14} />
            Statements
          </Link>
          <Link href="/governance/documents" className="btn-primary">
            <FileText size={14} />
            Manage Documents
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <button
          type="button"
          onClick={() => setPerfOpen(true)}
          className="rounded-xl border border-slate-200 bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Performance</p>
              {governanceHealthGrade && (
                <span className={`mt-1.5 inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${scoreBand(governanceHealthScore).pill}`}>
                  {governanceHealthGrade}
                </span>
              )}
              <p className="mt-1.5 text-[11px] text-slate-400">{sectionCards.length} weighted sections</p>
            </div>
            <ScoreRing score={governanceHealthScore} size={64} />
          </div>
        </button>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Needs Attention</p>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </div>
          <p className="mt-1 text-2xl font-bold text-amber-600">{attentionQueue?.total ?? 0}</p>
          <div className="mt-1.5 space-y-0.5">
            {attentionItems.filter((i) => i.value > 0).slice(0, 3).map((i) => (
              <Link key={i.label} href={i.href} className="flex items-center justify-between text-[11px] text-slate-500 hover:text-slate-800">
                <span className="truncate">{i.label}</span>
                <span className="ml-2 font-semibold text-slate-700">{i.value}</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Documents</p>
            <FileText className="h-4 w-4 text-blue-500" />
          </div>
          <p className="mt-1 text-2xl font-bold text-slate-900">{totalDocuments}</p>
          <div className="mt-2 h-1.5 rounded-full bg-slate-100">
            <div
              className="h-1.5 rounded-full bg-emerald-500"
              style={{ width: `${publishedPct}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-slate-400">{publishedCount} published · {publishedPct}% live</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Coverage</p>
            <Shield className="h-4 w-4 text-emerald-500" />
          </div>
          <p className="mt-1 text-2xl font-bold text-emerald-600">{Math.round(complianceRate)}%</p>
          <div className="mt-2 h-1.5 rounded-full bg-slate-100">
            <div
              className="h-1.5 rounded-full bg-emerald-500"
              style={{ width: `${Math.min(100, Math.round(complianceRate))}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-slate-400">documents mapped to controls &amp; frameworks</p>
        </div>
      </div>

      {/* score breakdown — collapsible, mirroring the IT-Assets inventory scorecard */}
      {sectionCards.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <button
            type="button"
            onClick={() => setShowBreakdown((v) => !v)}
            aria-expanded={showBreakdown}
            className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left"
          >
            <span className="flex items-center gap-3">
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-blue-50 text-blue-600">
                <Layers className="h-5 w-5" />
              </span>
              <span className="flex flex-col">
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  Score breakdown
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    {sectionCards.length} sections
                  </span>
                </span>
                <span className="text-[11px] text-slate-500">
                  Each area scored by its own formulas — click a card for the formula and its weight
                </span>
              </span>
            </span>
            <span className="flex flex-none items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600">
              {showBreakdown ? 'Hide' : 'Show'}
              <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${showBreakdown ? 'rotate-180' : ''}`} />
            </span>
          </button>
          {showBreakdown && (
            <div className="border-t border-slate-100 p-4" style={scoreCardRow(sectionCards.length)}>
              {sectionCards.map((section, i) => (
                <ScoreBreakdownCard
                  key={section.key}
                  section={section}
                  variant={i % 2 === 0 ? 'leader' : 'bars'}
                  onOpen={() => setOpenSection(section)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <SectionDetailModal section={openSection} onClose={() => setOpenSection(null)} tuning={GOVERNANCE_TUNING} />

      <AnimatedModal
        isOpen={perfOpen}
        onClose={() => { setPerfOpen(false); setTuning(false); }}
        size="lg"
        title="Performance Score"
        subtitle="Weighted mean of the module's section scores"
      >
        <div className="p-5">
          <div className="mb-4 flex items-center gap-4 rounded-xl bg-slate-50 p-4">
            <ScoreRing score={governanceHealthScore} size={72} />
            <div className="min-w-0 flex-1">
              {governanceHealthGrade && (
                <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${scoreBand(governanceHealthScore).pill}`}>
                  {governanceHealthGrade}
                </span>
              )}
              <p className="mt-1.5 text-xs leading-5 text-slate-500">
                Each section is scored by its own formulas, then blended by weight. Sections with
                no data are excluded and the remaining weights re-normalize.
              </p>
            </div>
            {!tuning && sectionCards.length > 0 && (
              <button
                type="button"
                onClick={() => setTuning(true)}
                className="inline-flex flex-shrink-0 items-center gap-1 self-start rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700"
              >
                <SlidersHorizontal className="h-3 w-3" /> Adjust weights
              </button>
            )}
          </div>

          {tuning ? (
            <SectionWeightTuner
              sections={sectionCards}
              configBase={GOVERNANCE_TUNING.configBase}
              invalidateKey={GOVERNANCE_TUNING.invalidateKey}
              onClose={() => setTuning(false)}
            />
          ) : (
          <>
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {perfComponents.map((c) => (
              <div key={c.key} className="px-4 py-3">
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-slate-800">{c.label}</span>
                    <span className="flex-shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                      w&nbsp;{Math.round(c.weight * 100)}%
                    </span>
                  </span>
                  <span className="flex flex-shrink-0 items-baseline gap-2">
                    <span className="text-[11px] tabular-nums text-slate-400">
                      {c.score == null ? '' : `+${(c.score * c.weight).toFixed(1)} pts`}
                    </span>
                    <span className={`text-sm font-bold tabular-nums ${scoreTone(c.score)}`}>
                      {c.score == null ? 'n/a' : `${Math.round(c.score)}%`}
                    </span>
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-2 rounded-full"
                    style={{
                      width: `${c.score == null ? 0 : Math.max(0, Math.min(100, c.score))}%`,
                      backgroundColor: c.score == null ? '#e2e8f0' : scoreBand(c.score).hex,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50 px-3.5 py-2.5">
            <p className="text-[11px] leading-5 text-slate-600">
              <span className="font-semibold text-slate-700">Performance score</span>{' = '}
              {perfComponents
                .filter((c) => c.score != null)
                .map((c) => `${c.label} × ${Math.round(c.weight * 100)}%`)
                .join(' + ')}
              {' = '}
              <span className="font-bold text-slate-800">{governanceHealthScore}</span>
            </p>
          </div>
          </>
          )}
        </div>
      </AnimatedModal>

      <div className="grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Governance Posture Radar</h2>
              <p className="text-[11px] text-slate-500">Backend-computed scores vs target — hover a metric for its formula</p>
            </div>
            <Shield className="h-4 w-4 text-blue-600" />
          </div>
          <GovernanceHealthRadar data={healthRadarData} />
          <button
            type="button"
            onClick={() => setPerfOpen(true)}
            className="mt-2 w-full rounded-lg border border-slate-100 bg-slate-50 px-3 py-1.5 text-center text-[11px] text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            How is the score calculated? View the full breakdown
          </button>
        </div>

        <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Content Throughput</h2>
              <p className="text-[11px] text-slate-500">Created vs published trend</p>
            </div>
            <TrendingUp className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="mb-3 grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-center">
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Created</p>
              <p className="text-sm font-semibold text-slate-900">{createdTotal}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-center">
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Published</p>
              <p className="text-sm font-semibold text-emerald-600">{publishedTotalInPeriod}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-center">
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Live rate</p>
              <p className="text-sm font-semibold text-blue-600">{publishRate}%</p>
            </div>
          </div>
          <div className="min-h-[190px] flex-1">
            {trendData.length > 0 ? (
              <TrendAreaChart data={trendData} />
            ) : (
              <div className="empty-state py-8">
                <TrendingUp className="h-8 w-8 text-[var(--color-muted)]" />
                <p className="cw-text-muted mt-2 text-sm">No trend data available</p>
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
