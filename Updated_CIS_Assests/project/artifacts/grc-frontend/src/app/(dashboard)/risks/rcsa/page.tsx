'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { rcsaApi } from '@/lib/api';
import {
  ClipboardList,
  AlertTriangle,
  TrendingUp,
  Plus,
  FileText,
  Eye,
  CheckCircle,
  Clock,
  PlayCircle,
  Activity,
  Layers,
  ChevronRight,
  PieChart as PieIcon,
  BarChart3,
  Building2,
  Shield,
  Gauge,
} from 'lucide-react';
import { Link } from 'wouter';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
} from 'recharts';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  active: 'Active',
  closed: 'Closed',
  not_started: 'Not Started',
  in_progress: 'In Progress',
  submitted: 'Submitted',
  under_review: 'Under Review',
  approved: 'Approved',
  rejected: 'Rejected',
};

const STATUS_BADGE: Record<string, { bg: string; text: string }> = {
  draft: { bg: 'bg-slate-500 border border-slate-600', text: 'text-white' },
  active: { bg: 'bg-emerald-600 border border-emerald-700', text: 'text-white' },
  closed: { bg: 'bg-blue-600 border border-blue-700', text: 'text-white' },
  not_started: { bg: 'bg-slate-500 border border-slate-600', text: 'text-white' },
  in_progress: { bg: 'bg-blue-600 border border-blue-700', text: 'text-white' },
  submitted: { bg: 'bg-purple-600 border border-purple-700', text: 'text-white' },
  under_review: { bg: 'bg-amber-600 border border-amber-700', text: 'text-white' },
  approved: { bg: 'bg-emerald-600 border border-emerald-700', text: 'text-white' },
  rejected: { bg: 'bg-rose-600 border border-rose-700', text: 'text-white' },
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e',
};

// Canonical 5-pill severity legend used elsewhere
const SEVERITY_LEGEND = [
  { label: 'Very Low', color: '#06b6d4' },
  { label: 'Low', color: '#22c55e' },
  { label: 'Medium', color: '#eab308' },
  { label: 'High', color: '#f97316' },
  { label: 'Critical', color: '#ef4444' },
];

const TOOLTIP_STYLE = {
  backgroundColor: '#ffffff',
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  color: '#111827',
  fontSize: 12,
};

interface DashboardSummary {
  active_campaigns: number;
  pending_assessments: number;
  open_findings: number;
  completion_rate: number;
}

interface Campaign {
  id: number;
  name: string;
  template_name: string;
  status: string;
  period: string;
  progress: number;
  assigned_units: number;
}

interface BUProgress {
  business_unit: string;
  completion_rate: number;
  total_assessments: number;
  completed_assessments: number;
}

interface FindingsBySeverity {
  severity: string;
  count: number;
}

interface Assessment {
  id: number;
  campaign_id: number;
  campaign_name: string;
  business_unit_name: string;
  status: string;
  due_date: string;
  progress: number;
}

export default function RCSADashboardPage() {
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['rcsa-dashboard-summary'],
    queryFn: async () => {
      try {
        const response = await rcsaApi.getDashboardSummary();
        return response.data as DashboardSummary;
      } catch {
        return { active_campaigns: 0, pending_assessments: 0, open_findings: 0, completion_rate: 0 } as DashboardSummary;
      }
    },
  });

  const { data: recentCampaigns, isLoading: campaignsLoading } = useQuery({
    queryKey: ['rcsa-recent-campaigns'],
    queryFn: async () => {
      try {
        const response = await rcsaApi.getRecentCampaigns();
        return response.data as Campaign[];
      } catch {
        return [] as Campaign[];
      }
    },
  });

  const { data: buProgress, isLoading: buLoading } = useQuery({
    queryKey: ['rcsa-bu-progress'],
    queryFn: async () => {
      try {
        const response = await rcsaApi.getBUProgress();
        return response.data as BUProgress[];
      } catch {
        return [] as BUProgress[];
      }
    },
  });

  const { data: findingsBySeverity, isLoading: findingsLoading } = useQuery({
    queryKey: ['rcsa-findings-severity'],
    queryFn: async () => {
      try {
        const response = await rcsaApi.getFindingsBySeverity();
        const data = response.data as { critical: number; high: number; medium: number; low: number };
        return [
          { severity: 'critical', count: data.critical || 0 },
          { severity: 'high', count: data.high || 0 },
          { severity: 'medium', count: data.medium || 0 },
          { severity: 'low', count: data.low || 0 },
        ] as FindingsBySeverity[];
      } catch {
        return [{ severity: 'critical', count: 0 }, { severity: 'high', count: 0 }, { severity: 'medium', count: 0 }, { severity: 'low', count: 0 }] as FindingsBySeverity[];
      }
    },
  });

  const { data: myAssessments, isLoading: assessmentsLoading } = useQuery({
    queryKey: ['rcsa-my-assessments'],
    queryFn: async () => {
      try {
        const response = await rcsaApi.getAssessments({ mine: true });
        return response.data as Assessment[];
      } catch {
        return [] as Assessment[];
      }
    },
  });

  const { data: pendingReviews, isLoading: pendingReviewsLoading } = useQuery({
    queryKey: ['rcsa-pending-reviews'],
    queryFn: async () => {
      try {
        const response = await rcsaApi.getAssessments({ status: 'submitted' });
        return response.data as Assessment[];
      } catch {
        return [] as Assessment[];
      }
    },
  });

  const { data: allAssessments } = useQuery({
    queryKey: ['rcsa-all-assessments'],
    queryFn: async () => {
      try {
        const response = await rcsaApi.getAssessments({});
        return response.data as Assessment[];
      } catch {
        return [] as Assessment[];
      }
    },
  });

  const isLoading = summaryLoading || campaignsLoading || buLoading || findingsLoading || assessmentsLoading || pendingReviewsLoading;

  // ── Derived data for new charts ─────────────────────────────────────────────
  const assessmentPipelineData = useMemo(() => {
    const all = allAssessments || [];
    return [
      { stage: 'Not Started', key: 'not_started', color: '#94a3b8', count: all.filter(a => a.status === 'not_started').length },
      { stage: 'In Progress', key: 'in_progress', color: '#3b82f6', count: all.filter(a => a.status === 'in_progress').length },
      { stage: 'Submitted',   key: 'submitted',   color: '#8b5cf6', count: all.filter(a => a.status === 'submitted').length },
      { stage: 'Under Review',key: 'under_review',color: '#f59e0b', count: all.filter(a => a.status === 'under_review').length },
      { stage: 'Approved',    key: 'approved',    color: '#22c55e', count: all.filter(a => a.status === 'approved').length },
      { stage: 'Rejected',    key: 'rejected',    color: '#ef4444', count: all.filter(a => a.status === 'rejected').length },
    ].filter(s => s.count > 0 || ['not_started','in_progress','submitted','approved'].includes(s.key));
  }, [allAssessments]);

  const campaignStatusDist = useMemo(() => {
    const all = recentCampaigns || [];
    const groups: Record<string, number> = {};
    all.forEach(c => { groups[c.status] = (groups[c.status] || 0) + 1; });
    const colorMap: Record<string, string> = { active: '#22c55e', closed: '#3b82f6', draft: '#94a3b8' };
    return Object.entries(groups).map(([status, count]) => ({
      name: STATUS_LABELS[status] || status,
      value: count,
      color: colorMap[status] || '#6366f1',
    }));
  }, [recentCampaigns]);

  const rcsaMaturityData = useMemo(() => {
    const completionRate = summary?.completion_rate || 0;
    const activeCampaigns = summary?.active_campaigns || 0;
    const openFindings = summary?.open_findings || 0;
    const totalAss = (allAssessments || []).length;
    const approvedAss = (allAssessments || []).filter(a => a.status === 'approved').length;
    const qualityScore = totalAss > 0 ? Math.round((approvedAss / totalAss) * 100) : 0;
    const coverageScore = Math.min(100, activeCampaigns * 20);
    const findingsMgmt = openFindings === 0 ? 100 : Math.max(0, 100 - Math.round((openFindings / Math.max(totalAss, 1)) * 50));
    return [
      { subject: 'Completion', score: Math.round(completionRate) },
      { subject: 'Quality', score: qualityScore },
      { subject: 'Coverage', score: coverageScore },
      { subject: 'Findings Mgmt', score: findingsMgmt },
      { subject: 'Timeliness', score: (pendingReviews || []).length === 0 ? 100 : Math.max(0, 100 - (pendingReviews || []).length * 10) },
    ];
  }, [summary, allAssessments, pendingReviews]);

  if (isLoading) {
    return (
      <div className="space-y-4 sm:space-y-6">
        <div className="h-8 w-64 animate-pulse rounded-lg bg-slate-100" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl border border-slate-200 bg-slate-50" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <div className="h-72 animate-pulse rounded-xl border border-slate-200 bg-slate-50 lg:col-span-2" />
          <div className="h-72 animate-pulse rounded-xl border border-slate-200 bg-slate-50" />
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="h-64 animate-pulse rounded-xl border border-slate-200 bg-slate-50" />
          <div className="h-64 animate-pulse rounded-xl border border-slate-200 bg-slate-50" />
        </div>
      </div>
    );
  }

  const findingsChartData = (findingsBySeverity || []).map((f) => ({
    label: f.severity,
    value: f.count,
    color: SEVERITY_COLORS[f.severity] || '#94a3b8',
  }));
  const totalFindings = findingsChartData.reduce((sum, f) => sum + f.value, 0);

  const buChartData = (buProgress || [])
    .slice(0, 8)
    .sort((a, b) => b.completion_rate - a.completion_rate)
    .map((bu) => {
      const name = bu.business_unit ?? 'Unknown';
      return {
        name: name.length > 20 ? name.slice(0, 20) + '\u2026' : name,
        rate: Math.round(bu.completion_rate ?? 0),
        rawRate: bu.completion_rate ?? 0,
      };
    });

  const campaignProgressData = (recentCampaigns || [])
    .slice(0, 6)
    .map((c) => {
      const name = c.name ?? 'Untitled';
      return {
        name: name.length > 22 ? name.slice(0, 22) + '\u2026' : name,
        progress: c.progress ?? 0,
      };
    });

  const kpis: Array<{
    name: string;
    value: string | number;
    icon: typeof ClipboardList;
    href: string;
    sublabel: string;
    border: string;
    bg: string;
    hoverBorder: string;
    iconColor: string;
    labelColor: string;
    sublabelColor: string;
  }> = [
    {
      name: 'Active Campaigns',
      value: summary?.active_campaigns || 0,
      icon: ClipboardList,
      href: '/risks/rcsa/campaigns',
      sublabel: 'Running now',
      border: 'border-blue-200',
      bg: 'bg-blue-50',
      hoverBorder: 'hover:border-blue-300',
      iconColor: 'text-blue-600',
      labelColor: 'text-blue-700',
      sublabelColor: 'text-blue-600/80',
    },
    {
      name: 'Pending Assessments',
      value: summary?.pending_assessments || 0,
      icon: Clock,
      href: '/risks/rcsa/campaigns',
      sublabel: 'Awaiting response',
      border: 'border-amber-200',
      bg: 'bg-amber-50',
      hoverBorder: 'hover:border-amber-300',
      iconColor: 'text-amber-600',
      labelColor: 'text-amber-700',
      sublabelColor: 'text-amber-600/80',
    },
    {
      name: 'Open Findings',
      value: summary?.open_findings || 0,
      icon: AlertTriangle,
      href: '/risks/rcsa/findings',
      sublabel: 'Need remediation',
      border: 'border-red-200',
      bg: 'bg-red-50',
      hoverBorder: 'hover:border-red-300',
      iconColor: 'text-red-600',
      labelColor: 'text-red-700',
      sublabelColor: 'text-red-600/80',
    },
    {
      name: 'Completion Rate',
      value: `${summary?.completion_rate || 0}%`,
      icon: TrendingUp,
      href: '/risks/rcsa/campaigns',
      sublabel: 'Across campaigns',
      border: 'border-emerald-200',
      bg: 'bg-emerald-50',
      hoverBorder: 'hover:border-emerald-300',
      iconColor: 'text-emerald-600',
      labelColor: 'text-emerald-700',
      sublabelColor: 'text-emerald-600/80',
    },
  ];

  // ── Health Snapshot mini metrics (derived from existing data) ──────────────
  const totalAssessmentsCount = (allAssessments || []).length;
  const approvedAssessmentsCount = (allAssessments || []).filter(a => a.status === 'approved').length;
  const approvedPct = totalAssessmentsCount > 0 ? Math.round((approvedAssessmentsCount / totalAssessmentsCount) * 100) : 0;
  const inProgressCount = (allAssessments || []).filter(a => a.status === 'in_progress').length;
  const submittedCount = (allAssessments || []).filter(a => a.status === 'submitted').length;
  const totalCampaignsCount = (recentCampaigns || []).length;
  const avgCampaignProgress = totalCampaignsCount > 0
    ? Math.round((recentCampaigns || []).reduce((s, c) => s + (c.progress || 0), 0) / totalCampaignsCount)
    : 0;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900">RCSA Dashboard</h1>
          <p className="mt-0.5 text-sm text-slate-500">Risk and control self-assessment overview</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/risks/rcsa/templates" className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
            <FileText className="h-4 w-4" />
            Templates
          </Link>
          <Link href="/risks/rcsa/findings" className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
            <Eye className="h-4 w-4" />
            View Findings
          </Link>
          <Link href="/risks/rcsa/campaigns?action=new" className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors">
            <Plus className="h-4 w-4" />
            New Campaign
          </Link>
        </div>
      </div>

      {/* KPI Tiles - solid soft palette with white-bg icon chips */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <Link
            key={kpi.name}
            href={kpi.href}
            className={`group rounded-xl border ${kpi.border} ${kpi.bg} p-3 sm:p-4 hover:shadow-md ${kpi.hoverBorder} transition-all`}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white shadow-sm">
                <kpi.icon className={`h-5 w-5 ${kpi.iconColor}`} />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-bold text-slate-900">{kpi.value}</p>
                <p className={`text-sm font-medium ${kpi.labelColor}`}>{kpi.name}</p>
                <p className={`text-xs ${kpi.sublabelColor}`}>{kpi.sublabel}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Mid Section: Findings + Pipeline (left, col-span-2) | Maturity Radar (right) */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {/* Left column: Findings by Severity + Pipeline funnel */}
        <div className="space-y-3 lg:col-span-2">
          {/* Findings by Severity Donut */}
          <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-50">
                  <PieIcon className="h-4 w-4 text-rose-600" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Findings by Severity</h3>
                  <p className="text-[11px] text-slate-500">Open findings distributed by risk level</p>
                </div>
              </div>
              <Link href="/risks/rcsa/findings" className="text-xs text-blue-600 inline-flex items-center gap-1 hover:underline">
                View All <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
            {totalFindings > 0 ? (
              <div className="flex items-center gap-6">
                <div className="h-44 w-44 flex-shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={findingsChartData.filter((f) => f.value > 0)}
                        cx="50%"
                        cy="50%"
                        innerRadius={44}
                        outerRadius={66}
                        dataKey="value"
                        stroke="none"
                        paddingAngle={2}
                      >
                        {findingsChartData.filter((f) => f.value > 0).map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 space-y-2.5">
                  {findingsChartData.filter((f) => f.value > 0).map((item) => (
                    <div key={item.label} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                        <span className="text-sm capitalize text-slate-700">{item.label}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-bold text-slate-900">{item.value}</span>
                        <span className="text-xs text-slate-400">
                          {totalFindings > 0 ? Math.round((item.value / totalFindings) * 100) : 0}%
                        </span>
                      </div>
                    </div>
                  ))}
                  <div className="mt-1 border-t border-slate-100 pt-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-500">Total Findings</span>
                      <span className="text-sm font-bold text-slate-900">{totalFindings}</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <CheckCircle className="mb-2 h-10 w-10 text-emerald-400" />
                <p className="text-sm font-semibold text-slate-900">No open findings</p>
                <p className="text-xs text-slate-500">All clear across campaigns</p>
              </div>
            )}
          </div>

          {/* Assessment Workflow Pipeline */}
          <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50">
                <Layers className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Assessment Workflow Pipeline</h3>
                <p className="text-[11px] text-slate-500">Stage-by-stage assessment distribution</p>
              </div>
            </div>
            {assessmentPipelineData.some(s => s.count > 0) ? (
              <>
                <div className="flex items-end gap-2 h-28">
                  {assessmentPipelineData.map((stage) => {
                    const maxCount = Math.max(...assessmentPipelineData.map(s => s.count), 1);
                    const barH = Math.max(12, (stage.count / maxCount) * 96);
                    return (
                      <div key={stage.key} className="flex flex-1 flex-col items-center gap-1">
                        <span className="text-xs font-bold" style={{ color: stage.color }}>{stage.count}</span>
                        <div className="w-full rounded-t-md transition-all duration-500" style={{ height: `${barH}px`, backgroundColor: stage.color }} />
                      </div>
                    );
                  })}
                </div>
                <div className="mt-1 flex gap-2">
                  {assessmentPipelineData.map(stage => (
                    <div key={stage.key} className="flex-1 text-center">
                      <p className="text-[10px] font-medium text-slate-600 leading-tight truncate">{stage.stage}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {assessmentPipelineData.filter(s => s.count > 0).map(stage => (
                    <div key={stage.key} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5" style={{ backgroundColor: stage.color + '15' }}>
                      <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: stage.color }} />
                      <span className="text-[11px] text-slate-600 truncate">{stage.stage}</span>
                      <span className="ml-auto text-xs font-semibold" style={{ color: stage.color }}>{stage.count}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Activity className="mb-2 h-10 w-10 text-slate-400" />
                <p className="text-sm font-semibold text-slate-900">No assessments yet</p>
                <p className="text-xs text-slate-500">Pipeline will populate once campaigns kick off</p>
              </div>
            )}
          </div>
        </div>

        {/* Right column: RCSA Maturity Radar + Health Snapshot */}
        <div className="space-y-3">
          {/* RCSA Maturity Radar */}
          <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50">
                <Gauge className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">RCSA Program Maturity</h3>
                <p className="text-[11px] text-slate-500">Multi-dimensional health</p>
              </div>
            </div>
            {rcsaMaturityData.some(d => d.score > 0) ? (
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={rcsaMaturityData} margin={{ top: 4, right: 16, bottom: 4, left: 16 }}>
                    <PolarGrid stroke="#e5e7eb" />
                    <PolarAngleAxis dataKey="subject" tick={{ fill: '#6b7280', fontSize: 10 }} />
                    <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
                    <Radar name="Score" dataKey="score" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} strokeWidth={2} dot={{ fill: '#3b82f6', r: 3 }} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [`${v}%`, 'Score']} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Activity className="mb-2 h-10 w-10 text-slate-400" />
                <p className="text-sm font-semibold text-slate-900">No maturity data</p>
                <p className="text-xs text-slate-500">Start campaigns to populate</p>
              </div>
            )}

            {campaignStatusDist.length > 0 && (
              <div className="mt-3 border-t border-slate-100 pt-3 space-y-1.5">
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Campaigns</p>
                {campaignStatusDist.map(item => (
                  <div key={item.name} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
                      <span className="text-xs text-slate-600">{item.name}</span>
                    </div>
                    <span className="text-xs font-bold text-slate-900">{item.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Health Snapshot */}
          <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50">
                <Shield className="h-4 w-4 text-emerald-600" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Health Snapshot</h3>
                <p className="text-[11px] text-slate-500">At-a-glance program metrics</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                <p className="text-lg font-bold text-slate-900">{totalAssessmentsCount}</p>
                <p className="text-[11px] text-slate-500">Total Assessments</p>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2">
                <p className="text-lg font-bold text-emerald-700">{approvedPct}%</p>
                <p className="text-[11px] text-emerald-700/80">Approved Rate</p>
              </div>
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-2">
                <p className="text-lg font-bold text-blue-700">{inProgressCount}</p>
                <p className="text-[11px] text-blue-700/80">In Progress</p>
              </div>
              <div className="rounded-lg border border-purple-200 bg-purple-50 p-2">
                <p className="text-lg font-bold text-purple-700">{submittedCount}</p>
                <p className="text-[11px] text-purple-700/80">Submitted</p>
              </div>
            </div>
            <div className="mt-3 border-t border-slate-100 pt-3">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Severity Legend</p>
              <div className="flex flex-wrap gap-1.5">
                {SEVERITY_LEGEND.map(s => (
                  <span
                    key={s.label}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                    style={{ backgroundColor: s.color }}
                  >
                    {s.label}
                  </span>
                ))}
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
              <span className="text-[11px] text-slate-500">Avg Campaign Progress</span>
              <span className="text-sm font-bold text-slate-900">{avgCampaignProgress}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Lower Section: BU Progress + Recent Campaigns list */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* BU Completion Horizontal Bar */}
        <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50">
                <Building2 className="h-4 w-4 text-emerald-600" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Business Unit Progress</h3>
                <p className="text-[11px] text-slate-500">Completion rate per business unit</p>
              </div>
            </div>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-500">
              {(buProgress || []).length} units
            </span>
          </div>
          {buChartData.length > 0 ? (
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={buChartData} layout="vertical" margin={{ left: 4, right: 28, top: 2, bottom: 2 }}>
                  <XAxis
                    type="number"
                    domain={[0, 100]}
                    tick={{ fill: '#6b7280', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={120}
                    tick={{ fill: '#374151', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [`${v}%`, 'Completion']} />
                  <Bar dataKey="rate" radius={[0, 4, 4, 0]} maxBarSize={16}>
                    {buChartData.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={entry.rawRate >= 80 ? '#22c55e' : entry.rawRate >= 60 ? '#f59e0b' : '#f43f5e'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Building2 className="mb-2 h-10 w-10 text-slate-400" />
              <p className="text-sm font-semibold text-slate-900">No business unit data</p>
              <p className="text-xs text-slate-500">Assign units to campaigns to see progress</p>
            </div>
          )}
        </div>

        {/* Recent Campaigns - compact list with progress bar per row */}
        <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50">
                <BarChart3 className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Recent Campaigns</h3>
                <p className="text-[11px] text-slate-500">Ongoing and recently completed</p>
              </div>
            </div>
            <Link href="/risks/rcsa/campaigns" className="text-xs text-blue-600 inline-flex items-center gap-1 hover:underline">
              View All <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          {(recentCampaigns || []).length > 0 ? (
            <div className="space-y-2.5">
              {(recentCampaigns || []).slice(0, 6).map((c) => {
                const badge = STATUS_BADGE[c.status] || STATUS_BADGE.draft;
                return (
                  <Link
                    key={c.id}
                    href={`/risks/rcsa/campaigns/${c.id}`}
                    className="block rounded-lg border border-slate-200 px-2.5 py-2 hover:border-blue-300 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-slate-900 truncate flex-1">{c.name}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.bg} ${badge.text}`}>
                        {STATUS_LABELS[c.status] || c.status}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${c.progress}%`,
                            backgroundColor: '#3b82f6',
                          }}
                        />
                      </div>
                      <span className="min-w-[2.5rem] text-right text-[11px] font-semibold text-slate-600">{c.progress}%</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500 truncate">{c.template_name} · {c.assigned_units} units</p>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <ClipboardList className="mb-2 h-10 w-10 text-slate-400" />
              <p className="text-sm font-semibold text-slate-900">No campaigns yet</p>
              <Link href="/risks/rcsa/campaigns?action=new" className="mt-2 text-xs font-medium text-blue-600 hover:underline">
                Create your first campaign →
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Campaign Progress Bar Chart */}
      {campaignProgressData.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50">
                <BarChart3 className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Campaign Progress</h3>
                <p className="text-[11px] text-slate-500">Completion percentage across recent campaigns</p>
              </div>
            </div>
            <Link href="/risks/rcsa/campaigns" className="text-xs text-blue-600 inline-flex items-center gap-1 hover:underline">
              View All <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={campaignProgressData} margin={{ top: 4, right: 16, left: 0, bottom: 28 }}>
                <XAxis
                  dataKey="name"
                  tick={{ fill: '#374151', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  angle={-15}
                  textAnchor="end"
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fill: '#6b7280', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [`${v}%`, 'Progress']} />
                <Bar dataKey="progress" radius={[4, 4, 0, 0]} maxBarSize={40} fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Recent Campaigns Table - detailed view */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50">
              <ClipboardList className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">All Campaigns</h3>
              <p className="text-[11px] text-slate-500">Detailed campaign breakdown</p>
            </div>
          </div>
          <Link href="/risks/rcsa/campaigns" className="text-xs text-blue-600 inline-flex items-center gap-1 hover:underline">
            View All <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
        {(recentCampaigns || []).length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Campaign</th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Template</th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Period</th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Status</th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Progress</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(recentCampaigns || []).map((campaign) => {
                  const badge = STATUS_BADGE[campaign.status] || STATUS_BADGE.draft;
                  return (
                    <tr key={campaign.id} className="transition-colors hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <p className="text-sm font-medium text-slate-900">{campaign.name}</p>
                        <p className="text-[11px] text-slate-500">{campaign.assigned_units} units</p>
                      </td>
                      <td className="px-3 py-2 text-sm text-slate-600">{campaign.template_name}</td>
                      <td className="px-3 py-2 text-sm text-slate-600">{campaign.period}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.bg} ${badge.text}`}>
                          {STATUS_LABELS[campaign.status] || campaign.status}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${campaign.progress}%`,
                                backgroundColor: campaign.progress >= 80 ? '#22c55e' : campaign.progress >= 60 ? '#f59e0b' : '#3b82f6',
                              }}
                            />
                          </div>
                          <span className="min-w-[2.25rem] text-[11px] font-semibold text-slate-600">{campaign.progress}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <Link href={`/risks/rcsa/campaigns/${campaign.id}`} className="inline-flex items-center justify-center rounded-md p-1.5 text-slate-500 hover:bg-blue-50 hover:text-blue-600 transition-colors">
                          <Eye className="h-4 w-4" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <ClipboardList className="mb-2 h-10 w-10 text-slate-400" />
            <p className="text-sm font-semibold text-slate-900">No campaigns yet</p>
            <p className="text-xs text-slate-500">Create your first RCSA campaign to get started</p>
            <Link href="/risks/rcsa/campaigns?action=new" className="mt-3 text-xs font-medium text-blue-600 hover:underline">
              Create your first campaign →
            </Link>
          </div>
        )}
      </div>

      {/* My Assessments + Pending Reviews row */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* My Assessments */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50">
                <PlayCircle className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">My Assessments</h3>
                <p className="text-[11px] text-slate-500">Assessments assigned to you</p>
              </div>
            </div>
          </div>
          {myAssessments && myAssessments.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Assessment</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Business Unit</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Due</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Status</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {myAssessments.map((assessment) => {
                    const badge = STATUS_BADGE[assessment.status] || STATUS_BADGE.draft;
                    const isActionable = assessment.status === 'in_progress' || assessment.status === 'not_started';
                    return (
                      <tr key={assessment.id} className="transition-colors hover:bg-slate-50">
                        <td className="px-3 py-2 text-sm font-medium text-slate-900 truncate max-w-[180px]">{assessment.campaign_name}</td>
                        <td className="px-3 py-2 text-sm text-slate-600 truncate max-w-[140px]">{assessment.business_unit_name}</td>
                        <td className="px-3 py-2 text-sm text-slate-600">
                          {assessment.due_date ? new Date(assessment.due_date).toLocaleDateString() : '—'}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.bg} ${badge.text}`}>
                            {STATUS_LABELS[assessment.status] || assessment.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <Link
                            href={`/risks/rcsa/assessments/${assessment.id}`}
                            className={`inline-flex items-center justify-center rounded-md p-1.5 transition-colors ${
                              isActionable ? 'text-blue-600 hover:bg-blue-50' : 'text-slate-500 hover:bg-slate-100'
                            }`}
                            title={isActionable ? 'Continue' : 'View'}
                          >
                            {isActionable ? <PlayCircle className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <ClipboardList className="mb-2 h-10 w-10 text-slate-400" />
              <p className="text-sm font-semibold text-slate-900">No assessments assigned</p>
              <p className="mt-0.5 text-xs text-slate-500">Assessments appear when a campaign assigns your unit</p>
            </div>
          )}
        </div>

        {/* Pending Reviews */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-50">
                <Clock className="h-4 w-4 text-amber-600" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900 inline-flex items-center gap-2">
                  Pending Reviews
                  {pendingReviews && pendingReviews.length > 0 && (
                    <span className="rounded-full bg-amber-600 border border-amber-700 px-2 py-0.5 text-[10px] font-semibold text-white">
                      {pendingReviews.length}
                    </span>
                  )}
                </h3>
                <p className="text-[11px] text-slate-500">Assessments awaiting your review</p>
              </div>
            </div>
          </div>
          {pendingReviews && pendingReviews.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Assessment</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Business Unit</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Submitted</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pendingReviews.map((assessment) => (
                    <tr key={assessment.id} className="transition-colors hover:bg-slate-50">
                      <td className="px-3 py-2 text-sm font-medium text-slate-900 truncate max-w-[180px]">{assessment.campaign_name}</td>
                      <td className="px-3 py-2 text-sm text-slate-600 truncate max-w-[140px]">{assessment.business_unit_name}</td>
                      <td className="px-3 py-2 text-sm text-slate-600">
                        {assessment.due_date ? new Date(assessment.due_date).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <Link
                          href={`/risks/rcsa/assessments/${assessment.id}?mode=review`}
                          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 transition-colors"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Review
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <CheckCircle className="mb-2 h-10 w-10 text-emerald-400" />
              <p className="text-sm font-semibold text-slate-900">No pending reviews</p>
              <p className="mt-0.5 text-xs text-slate-500">You&apos;re all caught up</p>
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Link href="/risks/rcsa/campaigns?action=new" className="group rounded-xl border border-blue-200 bg-blue-50 p-3 sm:p-4 hover:shadow-md hover:border-blue-300 transition-all">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-white shadow-sm">
              <Plus className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">New Campaign</p>
              <p className="text-xs text-blue-600/80">Start a new RCSA cycle</p>
            </div>
          </div>
        </Link>
        <Link href="/risks/rcsa/templates?action=new" className="group rounded-xl border border-emerald-200 bg-emerald-50 p-3 sm:p-4 hover:shadow-md hover:border-emerald-300 transition-all">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-white shadow-sm">
              <FileText className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">New Template</p>
              <p className="text-xs text-emerald-700/80">Build a custom RCSA template</p>
            </div>
          </div>
        </Link>
        <Link href="/risks/rcsa/findings" className="group rounded-xl border border-amber-200 bg-amber-50 p-3 sm:p-4 hover:shadow-md hover:border-amber-300 transition-all">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-white shadow-sm">
              <Eye className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">View Findings</p>
              <p className="text-xs text-amber-700/80">Review all RCSA findings</p>
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
}
