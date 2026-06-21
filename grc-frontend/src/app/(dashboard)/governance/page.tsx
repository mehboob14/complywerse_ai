'use client';

import { useQuery } from '@tanstack/react-query';
import { governanceApi, policyExceptionApi, committeeApi, regulatoryApi, attestationApi } from '@/lib/api';
import {
  FileText,
  CheckCircle,
  Clock,
  AlertTriangle,
  Calendar,
  ArrowRight,
  AlertCircle,
  BookOpen,
  FileCheck,
  ClipboardList,
  Lightbulb,
  Shield,
  Layers,
  Upload,
  Eye,
  TrendingUp,
  BarChart3,
  PieChart,
} from 'lucide-react';
import {
  PieChart as RPieChart,
  Pie,
  Cell,
  Tooltip as RTooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  RadarChart as RRadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
} from 'recharts';
import Link from 'next/link';

const STATUS_COLORS: Record<string, string> = {
  draft: 'var(--color-status-draft)',
  pending_review: 'var(--color-status-review)',
  pending_approval: 'var(--color-status-approval)',
  approved: 'var(--color-status-approved)',
  published: 'var(--color-status-published)',
  expired: 'var(--color-status-expired)',
  archived: 'var(--color-status-archived)',
};

const TYPE_ICONS: Record<string, React.ElementType> = {
  policy: BookOpen,
  standard: FileCheck,
  procedure: ClipboardList,
  guideline: Lightbulb,
  charter: Shield,
  framework: Layers,
};

const TYPE_COLORS: Record<string, { bg: string; text: string; fill: string }> = {
  policy: { bg: 'var(--color-base-soft)', text: 'var(--color-base)', fill: 'var(--color-base)' },
  standard: { bg: 'var(--color-success-soft)', text: 'var(--color-success)', fill: 'var(--color-success)' },
  procedure: { bg: 'var(--color-base-soft-strong)', text: 'var(--color-base)', fill: 'var(--color-base)' },
  guideline: { bg: 'var(--color-warning-soft)', text: 'var(--color-warning)', fill: 'var(--color-warning)' },
  charter: { bg: 'var(--color-warning-soft)', text: 'var(--color-warning)', fill: 'var(--color-warning)' },
  framework: { bg: 'var(--color-danger-soft)', text: 'var(--color-danger)', fill: 'var(--color-danger)' },
};

const DONUT_COLORS = [
  'var(--color-base)',
  'var(--color-success)',
  'var(--color-warning)',
  'var(--color-danger)',
  'var(--color-muted)',
  'var(--color-base-soft-strong)',
];

function DonutChart({ data, total }: { data: { label: string; value: number; color: string }[]; total: number }) {
  const filtered = data.filter((d) => d.value > 0);
  const chartData = filtered.length
    ? filtered.map((d) => ({ name: d.label, value: d.value, color: d.color }))
    : [{ name: 'None', value: 1, color: '#e2e8f0' }];
  return (
    <div className="flex items-center gap-6">
      <div className="relative h-40 w-40 flex-shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <RPieChart>
            <Pie data={chartData} cx="50%" cy="50%" innerRadius={46} outerRadius={64} dataKey="value" paddingAngle={filtered.length ? 2 : 0}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Pie>
            <RTooltip
              contentStyle={{ fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', color: '#1e293b' }}
            />
          </RPieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-2xl font-bold cw-text-default">{total}</span>
          <span className="text-xs cw-text-muted">Total</span>
        </div>
      </div>
      <div className="flex-1 space-y-2">
        {filtered.map((seg, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full flex-shrink-0" style={{ backgroundColor: seg.color }} />
            <span className="cw-text-default text-sm flex-1">{seg.label}</span>
            <span className="cw-text-default text-sm font-medium">{seg.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniMetricRing({
  label,
  percent,
  valueLabel,
  color,
  subtitle,
}: {
  label: string;
  percent: number;
  valueLabel: string;
  color: string;
  subtitle: string;
}) {
  const safePercent = Math.max(0, Math.min(100, percent));
  const chartData = [
    { name: label, value: safePercent, color },
    { name: 'remaining', value: 100 - safePercent, color: '#e2e8f0' },
  ];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-4">
        <div className="relative h-[78px] w-[78px] flex-shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <RPieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={24}
                outerRadius={34}
                dataKey="value"
                startAngle={90}
                endAngle={-270}
                stroke="none"
              >
                {chartData.map((entry, idx) => (
                  <Cell key={idx} fill={entry.color} />
                ))}
              </Pie>
            </RPieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-sm font-semibold" style={{ color }}>
              {safePercent}%
            </span>
          </div>
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">{valueLabel}</p>
          <p className="text-xs text-slate-500">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}

function GovernanceHealthRadar({
  data,
}: {
  data: { metric: string; score: number; target: number }[];
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
            <div key={item.metric}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium text-slate-700">{item.metric}</span>
                <span className="text-slate-500">{item.score}%</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100">
                <div className={`${tone} h-2 rounded-full`} style={{ width: `${item.score}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SpeedometerCard({
  score,
  subtitle,
  signals,
}: {
  score: number;
  subtitle: string;
  signals: { label: string; value: string; tone?: string }[];
}) {
  const safeScore = Math.max(0, Math.min(100, score));
  const scoreColor = safeScore >= 80 ? '#10b981' : safeScore >= 60 ? '#f59e0b' : '#ef4444';
  const gaugeData = [
    { name: 'score', value: safeScore, fill: scoreColor },
    { name: 'remaining', value: 100 - safeScore, fill: '#e5e7eb' },
  ];

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h2 className="card-title">Governance Health</h2>
          <p className="card-description">Single blended score</p>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-[220px_1fr] xl:items-center">
        <div className="relative mx-auto h-[210px] w-full max-w-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <RPieChart>
              <Pie
                data={gaugeData}
                cx="50%"
                cy="78%"
                startAngle={180}
                endAngle={0}
                innerRadius={58}
                outerRadius={82}
                dataKey="value"
                stroke="none"
              >
                {gaugeData.map((entry, idx) => (
                  <Cell key={idx} fill={entry.fill} />
                ))}
              </Pie>
            </RPieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pt-8">
            <span className="text-3xl font-semibold" style={{ color: scoreColor }}>{safeScore}%</span>
            <span className="mt-1 text-xs text-slate-500">overall health</span>
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-xs text-slate-500">{subtitle}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {signals.map((signal) => (
              <div key={signal.label} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{signal.label}</p>
                <p className={`mt-0.5 text-sm font-semibold ${signal.tone || 'text-slate-900'}`}>{signal.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function LollipopChart({
  items,
  valueSuffix = '',
}: {
  items: { label: string; value: number; color: string; meta?: string }[];
  valueSuffix?: string;
}) {
  const maxValue = Math.max(1, ...items.map((item) => item.value));

  if (!items.length) {
    return <div className="flex h-[220px] items-center justify-center text-xs cw-text-muted">No data available</div>;
  }

  return (
    <div className="space-y-4">
      {items.map((item) => {
        const width = Math.max(4, Math.round((item.value / maxValue) * 100));
        return (
          <div key={item.label}>
            <div className="mb-1 flex items-center justify-between gap-3 text-xs">
              <span className="font-medium text-slate-700">{item.label}</span>
              <span className="text-right text-slate-500">
                <span className="font-semibold text-slate-900">{item.value}{valueSuffix}</span>
                {item.meta ? <span className="ml-1">• {item.meta}</span> : null}
              </span>
            </div>
            <div className="relative h-2 rounded-full bg-slate-100">
              <div className="absolute left-0 top-1/2 h-2 -translate-y-1/2 rounded-full" style={{ width: `${width}%`, backgroundColor: item.color }} />
              <span
                className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-white shadow-sm"
                style={{ left: `calc(${width}% - 8px)`, backgroundColor: item.color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function GovernanceSunburst({
  rings,
  centerValue,
  centerLabel,
}: {
  rings: Array<{ label: string; items: Array<{ name: string; value: number; color: string }> }>;
  centerValue: string;
  centerLabel: string;
}) {
  const radii = [
    { inner: 34, outer: 54 },
    { inner: 58, outer: 78 },
    { inner: 82, outer: 102 },
  ];

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
      <div className="relative mx-auto h-[260px] w-[260px] flex-shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <RPieChart>
            {rings.map((ring, ringIndex) => {
              const data = ring.items.filter((item) => item.value > 0);
              return (
                <Pie
                  key={ring.label}
                  data={data.length ? data : [{ name: 'None', value: 1, color: '#e2e8f0' }]}
                  dataKey="value"
                  cx="50%"
                  cy="50%"
                  innerRadius={radii[ringIndex]?.inner || 34}
                  outerRadius={radii[ringIndex]?.outer || 54}
                  paddingAngle={2}
                  stroke="white"
                  strokeWidth={2}
                >
                  {(data.length ? data : [{ name: 'None', value: 1, color: '#e2e8f0' }]).map((entry, idx) => (
                    <Cell key={idx} fill={entry.color} />
                  ))}
                </Pie>
              );
            })}
            <RTooltip
              contentStyle={{ fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', color: '#1e293b' }}
            />
          </RPieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-2xl font-semibold text-slate-900">{centerValue}</span>
          <span className="text-xs text-slate-500">{centerLabel}</span>
        </div>
      </div>
      <div className="flex-1 space-y-3">
        {rings.map((ring) => (
          <div key={ring.label} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{ring.label}</p>
            <div className="space-y-1.5">
              {ring.items.filter((item) => item.value > 0).map((item) => (
                <div key={item.name} className="flex items-center gap-2 text-xs">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="flex-1 text-slate-600">{item.name}</span>
                  <span className="font-semibold text-slate-900">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GovernanceBowTie({
  leftNodes,
  rightNodes,
  centerLabel,
  centerValue,
}: {
  leftNodes: Array<{ label: string; value: number; hint: string; tone: string }>;
  rightNodes: Array<{ label: string; value: number; hint: string; tone: string }>;
  centerLabel: string;
  centerValue: string;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_170px_1fr] lg:items-center">
      <div className="space-y-3">
        {leftNodes.map((node) => (
          <div key={node.label} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 lg:mr-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-slate-700">{node.label}</p>
                <p className="text-[11px] text-slate-500">{node.hint}</p>
              </div>
              <span className={`text-lg font-semibold ${node.tone}`}>{node.value}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="relative mx-auto flex h-36 w-36 items-center justify-center rounded-full border-8 border-blue-100 bg-white text-center shadow-sm">
        <div className="absolute left-[-24px] top-1/2 hidden h-px w-6 -translate-y-1/2 bg-slate-300 lg:block" />
        <div className="absolute right-[-24px] top-1/2 hidden h-px w-6 -translate-y-1/2 bg-slate-300 lg:block" />
        <div>
          <p className="text-2xl font-semibold text-slate-900">{centerValue}</p>
          <p className="text-xs font-medium text-slate-500">{centerLabel}</p>
        </div>
      </div>

      <div className="space-y-3">
        {rightNodes.map((node) => (
          <div key={node.label} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 lg:ml-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-slate-700">{node.label}</p>
                <p className="text-[11px] text-slate-500">{node.hint}</p>
              </div>
              <span className={`text-lg font-semibold ${node.tone}`}>{node.value}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrendBarChart({ data }: { data: { month: string; created: number; published: number }[] }) {
  const chartData = data.slice(-6).map((item) => ({
    month: new Date(item.month + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
    Created: item.created,
    Published: item.published,
  }));
  if (!chartData.length) {
    return (
      <div className="flex h-[160px] items-center justify-center text-xs cw-text-muted">No trend data yet</div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={chartData} barSize={14} barCategoryGap="28%">
        <CartesianGrid strokeDasharray="2 2" stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={28} allowDecimals={false} />
        <RTooltip
          contentStyle={{ fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', color: '#1e293b' }}
        />
        <Bar dataKey="Created" fill="#60a5fa" radius={[4, 4, 0, 0]} />
        <Bar dataKey="Published" fill="#10b981" radius={[4, 4, 0, 0]} />
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
  const byType = summary?.by_type || {};
  const publishedCount = byStatus['published'] || 0;
  const pendingCount = pendingApprovals?.count || 0;
  const expiringCount = expiringSoon?.by_timeframe?.['30_days'] || 0;
  const overdueCount = overdueReviews?.count || 0;
  const reviewsDueThisMonth = reviewStats?.due_this_month || 0;
  const complianceRate = complianceCoverage?.overall_coverage_percent || 0;

  const mainKpis = [
    {
      name: 'Total Documents',
      value: totalDocuments,
      icon: FileText,
      iconColor: 'text-[var(--color-base)]',
      bgColor: 'bg-[var(--color-base-soft)]',
      href: '/governance/documents',
    },
    {
      name: 'Published',
      value: publishedCount,
      icon: CheckCircle,
      iconColor: 'text-[var(--color-success)]',
      bgColor: 'bg-[var(--color-success-soft)]',
      href: '/governance/documents?status=published',
    },
    {
      name: 'Pending Approvals',
      value: pendingCount,
      icon: Clock,
      iconColor: 'text-[var(--color-warning)]',
      bgColor: 'bg-[var(--color-warning-soft)]',
      href: '/governance/approvals',
    },
    {
      name: 'Overdue Reviews',
      value: overdueCount,
      icon: AlertTriangle,
      iconColor: 'text-[var(--color-danger)]',
      bgColor: 'bg-[var(--color-danger-soft)]',
      href: '/governance/reviews',
    },
  ];

  const publishedPct = totalDocuments > 0 ? Math.round((publishedCount / totalDocuments) * 100) : 0;
  const reviewLoadPct = totalDocuments > 0 ? Math.round((reviewsDueThisMonth / totalDocuments) * 100) : 0;
  const exceptionTotal = exceptionSummary?.total || 0;
  const exceptionAttentionCount = (exceptionSummary?.pending_approval || 0) + (exceptionSummary?.expiring_soon || 0);
  const exceptionAttentionPct = exceptionTotal > 0 ? Math.round((exceptionAttentionCount / exceptionTotal) * 100) : 0;
  const reviewHealthScore = reviewsDueThisMonth > 0 ? Math.max(0, 100 - Math.round((overdueCount / reviewsDueThisMonth) * 100)) : overdueCount > 0 ? 0 : 100;
  const approvalHealthScore = totalDocuments > 0 ? Math.max(0, 100 - Math.round((pendingCount / totalDocuments) * 100)) : 100;
  const freshnessScore = totalDocuments > 0 ? Math.max(0, 100 - Math.round((expiringCount / totalDocuments) * 100)) : 100;

  const healthRadarData = [
    { metric: 'Publishing', score: publishedPct, target: 85 },
    { metric: 'Coverage', score: Math.round(complianceRate), target: 85 },
    { metric: 'Reviews', score: reviewHealthScore, target: 85 },
    { metric: 'Approvals', score: approvalHealthScore, target: 85 },
    { metric: 'Freshness', score: freshnessScore, target: 85 },
    { metric: 'Exceptions', score: exceptionTotal > 0 ? Math.max(0, 100 - exceptionAttentionPct) : 100, target: 85 },
  ];

  const exceptionChartData = [
    { label: 'Pending Approval', value: exceptionSummary?.pending_approval || 0, color: '#f59e0b' },
    { label: 'Approved', value: exceptionSummary?.approved || 0, color: '#10b981' },
    { label: 'Expiring Soon', value: exceptionSummary?.expiring_soon || 0, color: '#f97316' },
    {
      label: 'Other',
      value: Math.max(0, exceptionTotal - (exceptionSummary?.pending_approval || 0) - (exceptionSummary?.approved || 0) - (exceptionSummary?.expiring_soon || 0)),
      color: '#94a3b8',
    },
  ];

  const typeChartData = [
    { label: 'Policies', value: byType['policy'] || 0, color: TYPE_COLORS.policy.fill },
    { label: 'Standards', value: byType['standard'] || 0, color: TYPE_COLORS.standard.fill },
    { label: 'Procedures', value: byType['procedure'] || 0, color: TYPE_COLORS.procedure.fill },
    { label: 'Guidelines', value: byType['guideline'] || 0, color: TYPE_COLORS.guideline.fill },
    { label: 'Charters', value: byType['charter'] || 0, color: TYPE_COLORS.charter.fill },
    { label: 'Frameworks', value: byType['framework'] || 0, color: TYPE_COLORS.framework.fill },
  ];

  const statusChartData = [
    { label: 'Published', value: byStatus['published'] || 0, color: STATUS_COLORS.published },
    { label: 'Draft', value: byStatus['draft'] || 0, color: STATUS_COLORS.draft },
    { label: 'In Review', value: byStatus['pending_review'] || 0, color: STATUS_COLORS.pending_review },
    { label: 'Approval', value: byStatus['pending_approval'] || 0, color: STATUS_COLORS.pending_approval },
    { label: 'Expired', value: byStatus['expired'] || 0, color: STATUS_COLORS.expired },
  ];

  const attentionChartData = [
    { label: 'Pending', value: pendingCount, color: '#f59e0b' },
    { label: 'Overdue', value: overdueCount, color: '#ef4444' },
    { label: 'Expiring', value: expiringCount, color: '#f97316' },
    { label: 'Exceptions', value: exceptionAttentionCount, color: '#8b5cf6' },
  ];

  const trendData = (trends?.created || []).map((item: { month: string; count: number }, idx: number) => ({
    month: item.month,
    created: item.count,
    published: trends?.published?.[idx]?.count || 0,
  }));

  const createdTotal = trendData.reduce((sum, item) => sum + item.created, 0);
  const publishedTotalInPeriod = trendData.reduce((sum, item) => sum + item.published, 0);
  const publishRate = createdTotal > 0 ? Math.round((publishedTotalInPeriod / createdTotal) * 100) : 0;

  const workflowPendingAll = workflowDashboard?.pending_all || pendingCount;
  const docsAwaitingApproval = workflowDashboard?.documents_awaiting_approval || pendingCount;
  const committeeCount = committeeDashboard?.total_committees || 0;
  const upcomingMeetings = committeeDashboard?.upcoming_meetings || 0;
  const openActions = committeeDashboard?.open_actions || 0;
  const overdueActions = committeeDashboard?.overdue_actions || 0;
  const regulatoryChanges = regulatoryDashboard?.total_changes || 0;
  const regulatoryPendingAssessments = regulatoryDashboard?.pending_assessments || 0;
  const regulatoryGaps = regulatoryDashboard?.gaps_identified || 0;
  const attestationCompletion = Number(attestationDashboard?.completion_rate || 0);
  const attestationPending = attestationDashboard?.pending_attestations || 0;
  const attestationOverdue = attestationDashboard?.overdue_attestations || 0;
  const openGapsTotal = openGapsSummary?.total_open_gaps || 0;

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

  const lifecycleItems = [
    { label: 'Published', value: byStatus['published'] || 0, color: '#10b981', meta: 'live' },
    { label: 'Draft', value: byStatus['draft'] || 0, color: '#94a3b8', meta: 'in authoring' },
    { label: 'Review', value: byStatus['pending_review'] || 0, color: '#3b82f6', meta: 'under review' },
    { label: 'Approval', value: byStatus['pending_approval'] || 0, color: '#f59e0b', meta: 'awaiting sign-off' },
    { label: 'Expired', value: byStatus['expired'] || 0, color: '#ef4444', meta: 'needs refresh' },
  ].filter((item) => item.value > 0 || item.label === 'Published');

  const frameworkItems = ((complianceByFramework?.frameworks || []) as Array<any>)
    .slice(0, 6)
    .map((fw) => ({
      label: fw.framework_name,
      value: Number(fw.compliance_percentage || 0),
      color: (fw.compliance_percentage || 0) >= 80 ? '#10b981' : (fw.compliance_percentage || 0) >= 60 ? '#f59e0b' : '#ef4444',
      meta: `${fw.fully_compliant || 0}/${fw.total_clauses || 0} clauses`,
    }));

  const frameworkCount = ((complianceByFramework?.frameworks || []) as Array<any>).length;
  const mappedFrameworkCount = ((complianceByFramework?.frameworks || []) as Array<any>).filter((fw) => (fw.total_clauses || 0) > 0).length;
  const strongFrameworkCount = ((complianceByFramework?.frameworks || []) as Array<any>).filter((fw) => Number(fw.compliance_percentage || 0) >= 80).length;
  const mappedClauseTotal = ((complianceByFramework?.frameworks || []) as Array<any>).reduce((sum, fw) => sum + Number(fw.fully_compliant || 0), 0);
  const totalClauseUniverse = ((complianceByFramework?.frameworks || []) as Array<any>).reduce((sum, fw) => sum + Number(fw.total_clauses || 0), 0);

  const oversightItems = [
    { label: 'Documents awaiting approval', value: docsAwaitingApproval, color: '#f59e0b', meta: `${workflowPendingAll} queued` },
    { label: 'Open committee actions', value: openActions, color: '#8b5cf6', meta: `${overdueActions} overdue` },
    { label: 'Pending attestations', value: attestationPending, color: '#0ea5e9', meta: `${attestationCompletion}% completion` },
    { label: 'Regulatory assessments', value: regulatoryPendingAssessments, color: '#2563eb', meta: `${regulatoryGaps} gaps` },
    { label: 'Exception attention', value: exceptionAttentionCount, color: '#f97316', meta: `${exceptionTotal} total` },
  ];

  const sunburstRings = [
    {
      label: 'Document lifecycle',
      items: [
        { name: 'Published', value: byStatus['published'] || 0, color: '#10b981' },
        { name: 'In authoring', value: (byStatus['draft'] || 0) + (byStatus['approved'] || 0), color: '#94a3b8' },
        { name: 'In review/approval', value: (byStatus['pending_review'] || 0) + (byStatus['pending_approval'] || 0), color: '#3b82f6' },
      ],
    },
    {
      label: 'Review pressure',
      items: [
        { name: 'Overdue reviews', value: overdueCount, color: '#ef4444' },
        { name: 'Due this month', value: reviewsDueThisMonth, color: '#f59e0b' },
        { name: 'Stable docs', value: Math.max(0, totalDocuments - overdueCount - reviewsDueThisMonth), color: '#e2e8f0' },
      ],
    },
    {
      label: 'Policy exceptions',
      items: [
        { name: 'Pending', value: exceptionSummary?.pending_approval || 0, color: '#f59e0b' },
        { name: 'Approved', value: exceptionSummary?.approved || 0, color: '#10b981' },
        { name: 'Expiring', value: exceptionSummary?.expiring_soon || 0, color: '#f97316' },
      ],
    },
  ];

  const leftBowTieNodes = [
    { label: 'Regulatory changes', value: regulatoryChanges, hint: 'tracked obligations', tone: 'text-blue-600' },
    { label: 'Open gaps', value: openGapsTotal, hint: 'framework findings', tone: 'text-rose-600' },
    { label: 'Exceptions', value: exceptionAttentionCount, hint: 'attention needed', tone: 'text-amber-600' },
  ];

  const rightBowTieNodes = [
    { label: 'Committees', value: committeeCount, hint: 'oversight bodies', tone: 'text-violet-600' },
    { label: 'Meetings', value: upcomingMeetings, hint: 'upcoming sessions', tone: 'text-cyan-600' },
    { label: 'Actions', value: openActions, hint: 'follow-up items', tone: 'text-emerald-600' },
  ];

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
          <Link href="/governance/attestations" className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50">
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
        <div className="rounded-xl border border-slate-200 border-l-4 border-l-blue-500 bg-white p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Documents</p>
          <p className="mt-1 text-xl font-bold text-slate-900">{totalDocuments}</p>
          <p className="mt-1 text-[11px] text-slate-400">governed portfolio</p>
        </div>
        <div className="rounded-xl border border-slate-200 border-l-4 border-l-emerald-500 bg-white p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Published</p>
          <p className="mt-1 text-xl font-bold text-emerald-600">{publishedCount}</p>
          <p className="mt-1 text-[11px] text-slate-400">{publishedPct}% live</p>
        </div>
        <div className="rounded-xl border border-slate-200 border-l-4 border-l-amber-500 bg-white p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Pending Flow</p>
          <p className="mt-1 text-xl font-bold text-amber-600">{workflowPendingAll}</p>
          <p className="mt-1 text-[11px] text-slate-400">reviews and approvals</p>
        </div>
        <div className="rounded-xl border border-slate-200 border-l-4 border-l-violet-500 bg-white p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Coverage</p>
          <p className="mt-1 text-xl font-bold text-violet-600">{Math.round(complianceRate)}%</p>
          <p className="mt-1 text-[11px] text-slate-400">framework mapping</p>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Document Status</h2>
              <p className="text-[11px] text-slate-500">Live vs in workflow</p>
            </div>
            <CheckCircle className="h-4 w-4 text-emerald-500" />
          </div>
          <DonutChart data={statusChartData} total={totalDocuments} />
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Portfolio Mix</h2>
              <p className="text-[11px] text-slate-500">Policies, standards, and frameworks</p>
            </div>
            <Layers className="h-4 w-4 text-blue-500" />
          </div>
          <DonutChart data={typeChartData} total={totalDocuments} />
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Attention Queue</h2>
              <p className="text-[11px] text-slate-500">Items needing action</p>
            </div>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </div>
          <DonutChart data={attentionChartData} total={attentionChartData.reduce((sum, item) => sum + item.value, 0)} />
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Governance Posture Radar</h2>
              <p className="text-[11px] text-slate-500">Current score against target</p>
            </div>
            <Shield className="h-4 w-4 text-blue-600" />
          </div>
          <GovernanceHealthRadar data={healthRadarData} />
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Health Snapshot</h2>
              <p className="text-[11px] text-slate-500">Compact KPI rings</p>
            </div>
            <PieChart className="h-4 w-4 text-violet-500" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <MiniMetricRing label="Live docs" percent={publishedPct} valueLabel={`${publishedCount}`} color="#10b981" subtitle="published" />
            <MiniMetricRing label="Coverage" percent={Math.round(complianceRate)} valueLabel={`${Math.round(complianceRate)}%`} color="#2563eb" subtitle="mapped" />
            <MiniMetricRing label="Attestations" percent={Math.round(attestationCompletion)} valueLabel={`${attestationPending}`} color="#0ea5e9" subtitle="pending" />
            <MiniMetricRing label="Health" percent={governanceHealthScore} valueLabel={`${openGapsTotal}`} color="#8b5cf6" subtitle="open gaps" />
          </div>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Oversight Hotspots</h2>
              <p className="text-[11px] text-slate-500">Workflow, committee, attestation, and regulation load</p>
            </div>
            <BarChart3 className="h-4 w-4 text-violet-600" />
          </div>
          <LollipopChart items={oversightItems} />
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3">
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
          {trendData.length > 0 ? (
            <TrendBarChart data={trendData} />
          ) : (
            <div className="empty-state py-8">
              <TrendingUp className="h-8 w-8 text-[var(--color-muted)]" />
              <p className="cw-text-muted mt-2 text-sm">No trend data available</p>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Framework Mapping Results</h2>
              <p className="text-[11px] text-slate-500">Mapped controls and outcomes</p>
            </div>
            <Shield className="h-4 w-4 text-indigo-600" />
          </div>
          <div className="mb-3 grid grid-cols-2 gap-2 xl:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-center">
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Frameworks</p>
              <p className="text-sm font-semibold text-slate-900">{frameworkCount}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-center">
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Mapped</p>
              <p className="text-sm font-semibold text-slate-900">{mappedFrameworkCount}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-center">
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Results</p>
              <p className="text-sm font-semibold text-slate-900">{mappedClauseTotal}/{totalClauseUniverse}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-center">
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Strong</p>
              <p className="text-sm font-semibold text-emerald-600">{strongFrameworkCount}</p>
            </div>
          </div>
          {frameworkItems.length > 0 ? (
            <LollipopChart items={frameworkItems} valueSuffix="%" />
          ) : (
            <div className="flex h-[220px] items-center justify-center text-xs cw-text-muted">No framework mapping results yet</div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] text-red-700">Critical: {openGapsSummary?.by_severity?.critical || 0}</span>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] text-amber-700">High: {openGapsSummary?.by_severity?.high || 0}</span>
            <span className="rounded-full border border-yellow-200 bg-yellow-50 px-2.5 py-1 text-[11px] text-yellow-700">Medium: {openGapsSummary?.by_severity?.medium || 0}</span>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] text-emerald-700">Low: {openGapsSummary?.by_severity?.low || 0}</span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Lifecycle Bottlenecks</h2>
              <p className="text-[11px] text-slate-500">Where content is stacking up</p>
            </div>
            <Clock className="h-4 w-4 text-amber-600" />
          </div>
          <LollipopChart items={lifecycleItems} />
        </div>
      </div>
    </div>
  );
}
