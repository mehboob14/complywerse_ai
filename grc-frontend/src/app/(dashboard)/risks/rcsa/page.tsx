'use client';

import { useQuery } from '@tanstack/react-query';
import { rcsaApi } from '@/lib/api';
import {
  ClipboardList,
  AlertTriangle,
  TrendingUp,
  Plus,
  FileText,
  Eye,
  ArrowRight,
  CheckCircle,
  Clock,
  PlayCircle,
} from 'lucide-react';
import Link from 'next/link';
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
  draft: { bg: 'bg-gray-100', text: 'text-gray-600' },
  active: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
  closed: { bg: 'bg-blue-50', text: 'text-blue-700' },
  not_started: { bg: 'bg-gray-100', text: 'text-gray-600' },
  in_progress: { bg: 'bg-amber-50', text: 'text-amber-700' },
  submitted: { bg: 'bg-blue-50', text: 'text-blue-700' },
  under_review: { bg: 'bg-purple-50', text: 'text-purple-700' },
  approved: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
  rejected: { bg: 'bg-red-50', text: 'text-red-700' },
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e',
};

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

  const isLoading = summaryLoading || campaignsLoading || buLoading || findingsLoading || assessmentsLoading || pendingReviewsLoading;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 animate-pulse rounded-lg bg-gray-100" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl border border-gray-200 bg-gray-50" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="h-72 animate-pulse rounded-xl border border-gray-200 bg-gray-50" />
          <div className="h-72 animate-pulse rounded-xl border border-gray-200 bg-gray-50" />
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
    .map((bu) => ({
      name: bu.business_unit.length > 20 ? bu.business_unit.slice(0, 20) + '\u2026' : bu.business_unit,
      rate: Math.round(bu.completion_rate),
      rawRate: bu.completion_rate,
    }));

  const campaignProgressData = (recentCampaigns || [])
    .slice(0, 6)
    .map((c) => ({
      name: c.name.length > 22 ? c.name.slice(0, 22) + '\u2026' : c.name,
      progress: c.progress,
    }));

  const kpis = [
    {
      name: 'Active Campaigns',
      value: summary?.active_campaigns || 0,
      icon: ClipboardList,
      iconBg: 'bg-blue-50',
      iconColor: 'text-blue-600',
      href: '/risks/rcsa/campaigns',
      sublabel: 'Running now',
    },
    {
      name: 'Pending Assessments',
      value: summary?.pending_assessments || 0,
      icon: Clock,
      iconBg: 'bg-amber-50',
      iconColor: 'text-amber-600',
      href: '/risks/rcsa/campaigns',
      sublabel: 'Awaiting response',
    },
    {
      name: 'Open Findings',
      value: summary?.open_findings || 0,
      icon: AlertTriangle,
      iconBg: 'bg-red-50',
      iconColor: 'text-red-600',
      href: '/risks/rcsa/findings',
      sublabel: 'Need remediation',
    },
    {
      name: 'Completion Rate',
      value: `${summary?.completion_rate || 0}%`,
      icon: TrendingUp,
      iconBg: 'bg-emerald-50',
      iconColor: 'text-emerald-600',
      href: '/risks/rcsa/campaigns',
      sublabel: 'Across campaigns',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">RCSA Dashboard</h1>
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

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <Link key={kpi.name} href={kpi.href}>
            <div className="group cursor-pointer rounded-xl border border-slate-200 bg-white p-5 hover:border-blue-300 hover:shadow-sm transition-all">
              <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-xl ${kpi.iconBg}`}>
                <kpi.icon className={`h-5 w-5 ${kpi.iconColor}`} />
              </div>
              <p className="text-2xl font-bold text-black">{kpi.value}</p>
              <p className="mt-0.5 text-sm font-medium text-slate-700">{kpi.name}</p>
              <p className="text-xs text-slate-400">{kpi.sublabel}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

        {/* Findings by Severity Donut */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-black">Findings by Severity</h3>
            <p className="text-xs text-slate-500">Open findings distributed by risk level</p>
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
                      <span className="text-sm font-bold text-black">{item.value}</span>
                      <span className="text-xs text-slate-400">
                        {totalFindings > 0 ? Math.round((item.value / totalFindings) * 100) : 0}%
                      </span>
                    </div>
                  </div>
                ))}
                <div className="mt-1 border-t border-slate-100 pt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">Total Findings</span>
                    <span className="text-sm font-bold text-black">{totalFindings}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <CheckCircle className="mb-2 h-8 w-8 text-emerald-400" />
              <p className="text-sm font-medium text-slate-700">No open findings</p>
              <p className="text-xs text-slate-400">All clear across campaigns</p>
            </div>
          )}
        </div>

        {/* BU Completion Horizontal Bar */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-black">Business Unit Completion</h3>
              <p className="text-xs text-slate-500">Assessment completion rate per unit</p>
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
                        fill={entry.rawRate >= 80 ? '#22c55e' : entry.rawRate >= 50 ? '#eab308' : '#ef4444'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="py-10 text-center text-sm text-slate-400">No business unit data yet</div>
          )}
        </div>
      </div>

      {/* Campaign Progress Bar Chart */}
      {campaignProgressData.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-black">Campaign Progress</h3>
              <p className="text-xs text-slate-500">Completion percentage across recent campaigns</p>
            </div>
            <Link href="/risks/rcsa/campaigns" className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700">
              View all <ArrowRight className="h-3.5 w-3.5" />
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
                <Bar dataKey="progress" radius={[4, 4, 0, 0]} maxBarSize={40}>
                  {campaignProgressData.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={entry.progress >= 80 ? '#3b82f6' : entry.progress >= 50 ? '#8b5cf6' : '#94a3b8'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Recent Campaigns Table */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold text-black">Recent Campaigns</h3>
            <p className="text-xs text-slate-500">Ongoing and recently completed RCSA campaigns</p>
          </div>
          <Link href="/risks/rcsa/campaigns" className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700">
            View All <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        {(recentCampaigns || []).length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Campaign</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Template</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Period</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Progress</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(recentCampaigns || []).map((campaign) => {
                  const badge = STATUS_BADGE[campaign.status] || STATUS_BADGE.draft;
                  return (
                    <tr key={campaign.id} className="transition-colors hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <p className="text-sm font-medium text-black">{campaign.name}</p>
                        <p className="text-xs text-slate-500">{campaign.assigned_units} units</p>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">{campaign.template_name}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">{campaign.period}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge.bg} ${badge.text}`}>
                          {STATUS_LABELS[campaign.status] || campaign.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${campaign.progress}%`,
                                backgroundColor: campaign.progress >= 80 ? '#22c55e' : campaign.progress >= 50 ? '#3b82f6' : '#94a3b8',
                              }}
                            />
                          </div>
                          <span className="min-w-[2.5rem] text-xs font-medium text-slate-600">{campaign.progress}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/risks/rcsa/campaigns/${campaign.id}`} className="text-xs font-medium text-blue-600 hover:text-blue-700">
                          Details →
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
            <ClipboardList className="mb-2 h-8 w-8 text-slate-300" />
            <p className="text-sm text-slate-500">No campaigns yet</p>
            <Link href="/risks/rcsa/campaigns?action=new" className="mt-3 text-xs font-medium text-blue-600 hover:underline">
              Create your first campaign →
            </Link>
          </div>
        )}
      </div>

      {/* My Assessments */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold text-black">My Assessments</h3>
            <p className="text-xs text-slate-500">Assessments assigned to you</p>
          </div>
        </div>
        {myAssessments && myAssessments.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Assessment</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Business Unit</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Due Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {myAssessments.map((assessment) => {
                  const badge = STATUS_BADGE[assessment.status] || STATUS_BADGE.draft;
                  const isActionable = assessment.status === 'in_progress' || assessment.status === 'not_started';
                  return (
                    <tr key={assessment.id} className="transition-colors hover:bg-slate-50">
                      <td className="px-5 py-3 text-sm font-medium text-black">{assessment.campaign_name}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">{assessment.business_unit_name}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {assessment.due_date ? new Date(assessment.due_date).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge.bg} ${badge.text}`}>
                          {STATUS_LABELS[assessment.status] || assessment.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/risks/rcsa/assessments/${assessment.id}`}
                          className={`inline-flex items-center gap-1 text-xs font-medium ${
                            isActionable ? 'text-blue-600 hover:text-blue-700' : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          {isActionable
                            ? <><PlayCircle className="h-3.5 w-3.5" /> Continue</>
                            : <><Eye className="h-3.5 w-3.5" /> View</>}
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
            <ClipboardList className="mb-2 h-8 w-8 text-slate-300" />
            <p className="text-sm text-slate-500">No assessments assigned to you yet</p>
            <p className="mt-0.5 text-xs text-slate-400">Assessments appear here when a campaign assigns your business unit</p>
          </div>
        )}
      </div>

      {/* Pending Reviews */}
      {pendingReviews && pendingReviews.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-white">
          <div className="flex items-center gap-3 border-b border-amber-100 px-5 py-4">
            <Clock className="h-4 w-4 text-amber-500" />
            <div>
              <h3 className="text-sm font-semibold text-black">
                Pending Reviews
                <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                  {pendingReviews.length}
                </span>
              </h3>
              <p className="text-xs text-slate-500">Assessments awaiting your review</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Assessment</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Business Unit</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Submitted</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pendingReviews.map((assessment) => (
                  <tr key={assessment.id} className="transition-colors hover:bg-slate-50">
                    <td className="px-5 py-3 text-sm font-medium text-black">{assessment.campaign_name}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{assessment.business_unit_name}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {assessment.due_date ? new Date(assessment.due_date).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/risks/rcsa/assessments/${assessment.id}?mode=review`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors"
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
        </div>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Link href="/risks/rcsa/campaigns?action=new" className="group flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-5 hover:border-blue-300 hover:shadow-sm transition-all">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-blue-50 transition-colors group-hover:bg-blue-100">
            <Plus className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-black transition-colors group-hover:text-blue-600">New Campaign</p>
            <p className="text-xs text-slate-500">Start a new RCSA cycle</p>
          </div>
        </Link>
        <Link href="/risks/rcsa/templates?action=new" className="group flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-5 hover:border-emerald-300 hover:shadow-sm transition-all">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-50 transition-colors group-hover:bg-emerald-100">
            <FileText className="h-5 w-5 text-emerald-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-black transition-colors group-hover:text-emerald-700">New Template</p>
            <p className="text-xs text-slate-500">Build a custom RCSA template</p>
          </div>
        </Link>
        <Link href="/risks/rcsa/findings" className="group flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-5 hover:border-amber-300 hover:shadow-sm transition-all">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-amber-50 transition-colors group-hover:bg-amber-100">
            <Eye className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-black transition-colors group-hover:text-amber-700">View Findings</p>
            <p className="text-xs text-slate-500">Review all RCSA findings</p>
          </div>
        </Link>
      </div>
    </div>
  );
}
