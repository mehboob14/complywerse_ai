'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '@/lib/api';
import { ProgressRing, StatusBadge } from '@/components/ui';
import {
  RiskHeatmap,
  RadarChart,
  TrendLine,
  DonutChart,
  ProgressBar,
  KPICard,
  StatusDistribution,
  ChartEmptyState,
} from '@/components/charts';
import AIInsightsPanel from '@/components/dashboard/AIInsightsPanel';
import {
  Shield,
  AlertTriangle,
  FileText,
  Clock,
  CheckCircle,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  Calendar,
  ArrowRight,
  Activity,
  Target,
  Users,
  BookOpen,
  BarChart3,
  Layers,
  Bell,
  ExternalLink,
  ChevronRight,
  Scale,
  ClipboardCheck,
  Gavel,
  Building2,
  Flame,
  Eye,
} from 'lucide-react';
import Link from 'next/link';

interface UnifiedDashboard {
  executive_summary: {
    overall_compliance_score: number;
    risk_score: number;
    open_issues: number;
    pending_actions: number;
    trend: 'up' | 'down' | 'stable';
  };
  governance: {
    total_documents: number;
    by_status: Record<string, number>;
    pending_approvals: number;
    expiring_30_days: number;
    overdue_reviews: number;
    recent_publications: Array<{
      id: number;
      title: string;
      doc_type: string;
      published_at: string;
    }>;
  };
  risk: {
    total_risks: number;
    open_risks: number;
    by_category: Record<string, number>;
    by_score_range: { critical: number; high: number; medium: number; low: number };
    avg_residual_score: number;
    heatmap: Array<{ likelihood: number; impact: number; count: number }>;
    incidents_open: number;
    mitigations_overdue: number;
  };
  compliance: {
    frameworks_tracked: number;
    framework_coverage: Array<{
      framework_id: number;
      name: string;
      short_code: string;
      score: number;
      total_controls: number;
      implemented_controls: number;
      status: string;
    }>;
    overall_maturity: number;
    controls_implemented: number;
    controls_total: number;
    evidence_items: number;
    assessments_pending?: number;
  };
  attestations: {
    active_campaigns: number;
    pending_responses: number;
    completion_rate: number;
    overdue: number;
  };
  regulatory_changes: {
    total_changes: number;
    pending_review: number;
    high_impact: number;
    recent: Array<{
      id: number;
      title: string;
      impact_level: string;
      status: string;
    }>;
  };
  upcoming_deadlines: Array<{
    type: string;
    title: string;
    due_date: string;
    days_remaining: number;
    urgency: 'critical' | 'high' | 'medium' | 'low';
    link: string;
  }>;
  recent_activity: Array<{
    type: string;
    action: string;
    title: string;
    timestamp: string;
    status: string;
    link: string;
  }>;
  kpis: {
    compliance_trend: Array<{ month: string; value: number }>;
    risk_trend: Array<{ month: string; value: number }>;
    evidence_trend: Array<{ month: string; value: number }>;
  };
}

type TabType = 'overview' | 'governance' | 'risk' | 'compliance';

function formatTimeAgo(timestamp: string): string {
  const now = new Date();
  const time = new Date(timestamp);
  const diff = now.getTime() - time.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return time.toLocaleDateString();
}

function getActivityIcon(type: string) {
  switch (type) {
    case 'evidence':
      return FileText;
    case 'risk':
      return AlertTriangle;
    case 'control':
      return Shield;
    case 'incident':
      return Flame;
    case 'document':
      return BookOpen;
    default:
      return Activity;
  }
}

function getActivityColor(type: string) {
  switch (type) {
    case 'evidence':
      return 'text-blue-400 bg-blue-500/20';
    case 'risk':
      return 'text-amber-400 bg-amber-500/20';
    case 'control':
      return 'text-emerald-400 bg-emerald-500/20';
    case 'incident':
      return 'text-red-400 bg-red-500/20';
    case 'document':
      return 'text-primary-600 bg-primary-500/20';
    default:
      return 'text-slate-400 bg-slate-500/20';
  }
}

function getUrgencyColor(urgency: string) {
  switch (urgency) {
    case 'critical':
      return 'bg-red-500/20 text-red-400 border-red-500/30';
    case 'high':
      return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
    case 'medium':
      return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    default:
      return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
  }
}

function getScoreColor(score: number): 'success' | 'warning' | 'danger' | 'primary' {
  if (score >= 80) return 'success';
  if (score >= 60) return 'warning';
  if (score >= 40) return 'primary';
  return 'danger';
}

function getRiskScoreColor(score: number): string {
  if (score <= 25) return 'text-emerald-400';
  if (score <= 50) return 'text-yellow-400';
  if (score <= 75) return 'text-orange-400';
  return 'text-red-400';
}

export default function UnifiedGRCDashboard() {
  const [activeTab, setActiveTab] = useState<TabType>('overview');

  const { data: dashboardData, isLoading, error } = useQuery({
    queryKey: ['unified-dashboard'],
    queryFn: async () => {
      const response = await dashboardApi.getUnified();
      return response.data as UnifiedDashboard;
    },
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <div className="space-y-8 animate-pulse">
        <div className="page-header">
          <div className="h-8 w-72 rounded bg-slate-200" />
          <div className="h-5 w-96 rounded bg-slate-200 mt-2" />
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-white p-6">
              <div className="h-20 w-20 rounded-full bg-slate-200 mx-auto mb-4" />
              <div className="h-6 w-24 rounded bg-slate-200 mx-auto" />
            </div>
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-white p-6">
              <div className="h-6 w-32 rounded bg-slate-200 mb-4" />
              <div className="space-y-3">
                {[1, 2, 3].map((j) => (
                  <div key={j} className="h-12 rounded bg-slate-200" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const data = dashboardData || {
    executive_summary: { overall_compliance_score: 0, risk_score: 0, open_issues: 0, pending_actions: 0, trend: 'stable' },
    governance: { total_documents: 0, by_status: {}, pending_approvals: 0, expiring_30_days: 0, overdue_reviews: 0, recent_publications: [] },
    risk: { total_risks: 0, open_risks: 0, by_category: {}, by_score_range: { critical: 0, high: 0, medium: 0, low: 0 }, avg_residual_score: 0, heatmap: [], incidents_open: 0, mitigations_overdue: 0 },
    compliance: { frameworks_tracked: 0, framework_coverage: [], overall_maturity: 0, controls_implemented: 0, controls_total: 0, evidence_items: 0 },
    attestations: { active_campaigns: 0, pending_responses: 0, completion_rate: 0, overdue: 0 },
    regulatory_changes: { total_changes: 0, pending_review: 0, high_impact: 0, recent: [] },
    upcoming_deadlines: [],
    recent_activity: [],
    kpis: { compliance_trend: [], risk_trend: [], evidence_trend: [] },
  } as UnifiedDashboard;

  const tabs: { id: TabType; label: string; icon: React.ElementType }[] = [
    { id: 'overview', label: 'Overview', icon: Layers },
    { id: 'governance', label: 'Governance', icon: Gavel },
    { id: 'risk', label: 'Risk', icon: AlertTriangle },
    { id: 'compliance', label: 'Compliance', icon: Shield },
  ];

  const trendLabels = data.kpis.compliance_trend.map(t => ({ label: t.month, value: t.value }));
  const riskTrendLabels = data.kpis.risk_trend.map(t => ({ label: t.month, value: t.value }));

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title flex items-center gap-3">
              <div className="rounded-xl bg-gradient-to-br from-primary-500/20 to-primary-600/10 p-2.5">
                <Target className="h-6 w-6 text-primary-400" />
              </div>
              Unified GRC Dashboard
            </h1>
            <p className="page-description mt-1">
              Comprehensive view of Governance, Risk, and Compliance metrics
            </p>
          </div>
          <div className="hidden lg:flex items-center gap-2 text-sm text-slate-400">
            <Clock className="h-4 w-4" />
            Last updated: {new Date().toLocaleTimeString()}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 hover:border-primary-500/50 hover:shadow-[0_0_20px_-5px_rgba(59,130,246,0.3)] transition-all duration-300">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <p className="text-sm text-slate-400 mb-1">Overall Compliance</p>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-slate-800">{data.executive_summary.overall_compliance_score}%</span>
                {data.executive_summary.trend === 'up' && (
                  <span className="flex items-center text-xs text-emerald-400">
                    <TrendingUp className="h-3 w-3 mr-0.5" />↑ improving
                  </span>
                )}
                {data.executive_summary.trend === 'down' && (
                  <span className="flex items-center text-xs text-red-400">
                    <TrendingDown className="h-3 w-3 mr-0.5" />↓ declining
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-1">{data.compliance.frameworks_tracked} frameworks tracked</p>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-primary-500/20 to-primary-600/10 p-3">
              <Shield className="h-6 w-6 text-primary-400" />
            </div>
          </div>
          <div className="mt-4 h-2 rounded-full bg-slate-200 overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                data.executive_summary.overall_compliance_score >= 80 ? 'bg-emerald-500' :
                data.executive_summary.overall_compliance_score >= 60 ? 'bg-yellow-500' :
                'bg-red-500'
              }`}
              style={{ width: `${data.executive_summary.overall_compliance_score}%` }}
            />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 hover:border-amber-500/50 hover:shadow-[0_0_20px_-5px_rgba(245,158,11,0.3)] transition-all duration-300">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <p className="text-sm text-slate-400 mb-1">Risk Score</p>
              <div className="flex items-baseline gap-2">
                <span className={`text-3xl font-bold ${getRiskScoreColor(data.executive_summary.risk_score)}`}>
                  {data.executive_summary.risk_score}
                </span>
                <span className="text-xs text-slate-500">/ 100</span>
              </div>
              <p className="text-xs text-slate-500 mt-1">{data.risk.open_risks} open risks</p>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-600/10 p-3">
              <AlertTriangle className="h-6 w-6 text-amber-400" />
            </div>
          </div>
          <div className="mt-4 flex gap-1">
            {['critical', 'high', 'medium', 'low'].map((level) => {
              const count = data.risk.by_score_range[level as keyof typeof data.risk.by_score_range] || 0;
              const colors: Record<string, string> = {
                critical: 'bg-red-500',
                high: 'bg-orange-500',
                medium: 'bg-yellow-500',
                low: 'bg-green-500',
              };
              return (
                <div key={level} className="flex-1 text-center">
                  <div className={`h-2 rounded-full ${colors[level]} mb-1`} style={{ opacity: count > 0 ? 1 : 0.2 }} />
                  <span className="text-xs text-slate-500">{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 hover:border-red-500/50 hover:shadow-[0_0_20px_-5px_rgba(239,68,68,0.3)] transition-all duration-300">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <p className="text-sm text-slate-400 mb-1">Open Issues</p>
              <p className="text-3xl font-bold text-slate-800">{data.risk.incidents_open}</p>
              <p className="text-xs text-slate-500 mt-1">
                {data.risk.mitigations_overdue > 0 ? (
                  <span className="text-red-400">{data.risk.mitigations_overdue} overdue mitigations</span>
                ) : (
                  'No overdue mitigations'
                )}
              </p>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-red-500/20 to-red-600/10 p-3">
              <Flame className="h-6 w-6 text-red-400" />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 hover:border-primary-500/50 hover:shadow-[0_0_20px_-5px_rgba(168,85,247,0.3)] transition-all duration-300">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <p className="text-sm text-slate-400 mb-1">Pending Actions</p>
              <p className="text-3xl font-bold text-slate-800">{data.governance.pending_approvals}</p>
              <p className="text-xs text-slate-500 mt-1">
                {data.attestations.active_campaigns > 0 ? (
                  <span>{data.attestations.active_campaigns} active campaigns</span>
                ) : (
                  'No active campaigns'
                )}
              </p>
            </div>
            <div className="rounded-xl bg-gradient-to-br from-purple-500/20 to-purple-600/10 p-3">
              <ClipboardCheck className="h-6 w-6 text-primary-600" />
            </div>
          </div>
        </div>
      </div>

      <div className="border-b border-slate-200">
        <nav className="flex gap-1" aria-label="Dashboard tabs">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  flex items-center gap-2 px-4 py-3 text-sm font-medium transition-all duration-200
                  border-b-2 -mb-px
                  ${activeTab === tab.id
                    ? 'border-primary-500 text-primary-400 bg-primary-500/5'
                    : 'border-transparent text-slate-400 hover:text-slate-600 hover:bg-white/50'
                  }
                `}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <AIInsightsPanel />
            </div>

            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
                <div className="rounded-lg bg-emerald-500/20 p-2">
                  <BarChart3 className="h-4 w-4 text-emerald-400" />
                </div>
                <h3 className="text-sm font-semibold text-slate-800">Quick Stats</h3>
              </div>
              <div className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400">Total Documents</span>
                  <span className="text-lg font-semibold text-slate-800">{data.governance.total_documents}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400">Expiring (30d)</span>
                  <span className={`text-lg font-semibold ${data.governance.expiring_30_days > 0 ? 'text-amber-400' : 'text-slate-800'}`}>
                    {data.governance.expiring_30_days}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400">Evidence Items</span>
                  <span className="text-lg font-semibold text-slate-800">{data.compliance.evidence_items}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400">Controls Implemented</span>
                  <span className="text-lg font-semibold text-slate-800">
                    {data.compliance.controls_implemented}/{data.compliance.controls_total}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400">Regulatory Changes</span>
                  <span className={`text-lg font-semibold ${data.regulatory_changes.high_impact > 0 ? 'text-red-400' : 'text-slate-800'}`}>
                    {data.regulatory_changes.pending_review}
                    {data.regulatory_changes.high_impact > 0 && (
                      <span className="text-xs ml-1">({data.regulatory_changes.high_impact} high)</span>
                    )}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-blue-500/20 p-2">
                    <TrendingUp className="h-4 w-4 text-blue-400" />
                  </div>
                  <h3 className="text-sm font-semibold text-slate-800">Compliance Trend</h3>
                </div>
              </div>
              <div className="p-5">
                {trendLabels.length > 0 ? (
                  <TrendLine data={trendLabels} color="#3b82f6" height={120} />
                ) : (
                  <ChartEmptyState
                    title="No trend data yet"
                    description="Trend data will populate as compliance activities occur over time"
                    icon={<TrendingUp className="h-8 w-8 text-slate-500" />}
                  />
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-cyan-500/20 p-2">
                    <Activity className="h-4 w-4 text-cyan-400" />
                  </div>
                  <h3 className="text-sm font-semibold text-slate-800">Recent Activity</h3>
                </div>
                <Link href="/evidence" className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1">
                  View all <ChevronRight className="h-3 w-3" />
                </Link>
              </div>
              <div className="p-4">
                {data.recent_activity.length > 0 ? (
                  <div className="space-y-3">
                    {data.recent_activity.slice(0, 6).map((activity, idx) => {
                      const Icon = getActivityIcon(activity.type);
                      const colorClass = getActivityColor(activity.type);
                      return (
                        <Link
                          key={idx}
                          href={activity.link}
                          className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 transition-colors group"
                        >
                          <div className={`rounded-lg p-2 ${colorClass}`}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-slate-800 truncate group-hover:text-primary-400 transition-colors">
                              {activity.title}
                            </p>
                            <p className="text-xs text-slate-500">
                              {activity.action} • {formatTimeAgo(activity.timestamp)}
                            </p>
                          </div>
                          <StatusBadge status={activity.status} />
                        </Link>
                      );
                    })}
                  </div>
                ) : (
                  <ChartEmptyState
                    title="No recent activity"
                    description="Activity will appear here as you work with the system"
                    icon={<Activity className="h-8 w-8 text-slate-500" />}
                  />
                )}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-amber-500/20 p-2">
                    <Calendar className="h-4 w-4 text-amber-400" />
                  </div>
                  <h3 className="text-sm font-semibold text-slate-800">Upcoming Deadlines</h3>
                </div>
              </div>
              <div className="p-4">
                {data.upcoming_deadlines.length > 0 ? (
                  <div className="space-y-3">
                    {data.upcoming_deadlines.slice(0, 5).map((deadline, idx) => (
                      <Link
                        key={idx}
                        href={deadline.link}
                        className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 transition-colors group"
                      >
                        <div className={`rounded-lg px-2 py-1 text-xs font-medium border ${getUrgencyColor(deadline.urgency)}`}>
                          {deadline.days_remaining < 0
                            ? `${Math.abs(deadline.days_remaining)}d overdue`
                            : deadline.days_remaining === 0
                            ? 'Today'
                            : `${deadline.days_remaining}d`}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-slate-800 truncate group-hover:text-primary-400 transition-colors">
                            {deadline.title}
                          </p>
                          <p className="text-xs text-slate-500">
                            {new Date(deadline.due_date).toLocaleDateString()}
                          </p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-slate-500 group-hover:text-primary-400 transition-colors" />
                      </Link>
                    ))}
                  </div>
                ) : (
                  <ChartEmptyState
                    title="No upcoming deadlines"
                    description="Deadlines will appear here as policies and mitigations are scheduled"
                    icon={<Calendar className="h-8 w-8 text-slate-500" />}
                  />
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {data.compliance.framework_coverage.length > 0 ? (
              data.compliance.framework_coverage.slice(0, 3).map((framework) => (
                <div
                  key={framework.framework_id}
                  className="rounded-xl border border-slate-200 bg-white p-5 hover:border-slate-300 transition-colors"
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium px-2 py-0.5 rounded bg-primary-500/20 text-primary-400">
                        {framework.short_code}
                      </span>
                      <span className="text-sm font-medium text-slate-800 truncate max-w-[150px]" title={framework.name}>
                        {framework.name}
                      </span>
                    </div>
                    <span className={`text-lg font-bold ${
                      framework.score >= 80 ? 'text-emerald-400' :
                      framework.score >= 60 ? 'text-amber-400' : 'text-red-400'
                    }`}>
                      {framework.score}%
                    </span>
                  </div>
                  <ProgressBar
                    value={framework.score}
                    color={framework.score >= 80 ? 'success' : framework.score >= 60 ? 'warning' : 'danger'}
                    showPercentage={false}
                    size="md"
                  />
                  <p className="text-xs text-slate-500 mt-2">
                    {framework.implemented_controls} / {framework.total_controls} controls
                  </p>
                </div>
              ))
            ) : (
              <div className="lg:col-span-3 rounded-xl border border-slate-200 bg-white p-8">
                <ChartEmptyState
                  title="No frameworks tracked yet"
                  description="Upload compliance frameworks to begin tracking coverage and maturity"
                  icon={<Shield className="h-8 w-8 text-slate-500" />}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'governance' && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KPICard
              title="Total Documents"
              value={data.governance.total_documents}
              icon={<FileText className="h-5 w-5 text-blue-400" />}
              color="blue"
            />
            <KPICard
              title="Pending Approvals"
              value={data.governance.pending_approvals}
              subtitle={data.governance.pending_approvals > 0 ? 'Requires attention' : 'All clear'}
              icon={<ClipboardCheck className="h-5 w-5 text-primary-600" />}
              color="purple"
            />
            <KPICard
              title="Expiring Soon"
              value={data.governance.expiring_30_days}
              subtitle="Within 30 days"
              icon={<Clock className="h-5 w-5 text-amber-400" />}
              color="amber"
            />
            <KPICard
              title="Overdue Reviews"
              value={data.governance.overdue_reviews}
              subtitle={data.governance.overdue_reviews > 0 ? 'Action required' : 'Up to date'}
              icon={<AlertCircle className="h-5 w-5 text-red-400" />}
              color="red"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
                <div className="rounded-lg bg-blue-500/20 p-2">
                  <BarChart3 className="h-4 w-4 text-blue-400" />
                </div>
                <h3 className="text-sm font-semibold text-slate-800">Document Status</h3>
              </div>
              <div className="p-5">
                {Object.keys(data.governance.by_status).length > 0 ? (
                  <StatusDistribution data={data.governance.by_status} />
                ) : (
                  <ChartEmptyState
                    title="No documents yet"
                    description="Document status distribution will appear as policies are created"
                    icon={<FileText className="h-8 w-8 text-slate-500" />}
                  />
                )}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-emerald-500/20 p-2">
                    <BookOpen className="h-4 w-4 text-emerald-400" />
                  </div>
                  <h3 className="text-sm font-semibold text-slate-800">Recent Publications</h3>
                </div>
                <Link href="/governance/documents" className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1">
                  View all <ChevronRight className="h-3 w-3" />
                </Link>
              </div>
              <div className="p-4">
                {data.governance.recent_publications.length > 0 ? (
                  <div className="space-y-3">
                    {data.governance.recent_publications.map((pub: any) => (
                      <Link
                        key={pub.id}
                        href={`/governance/documents`}
                        className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 transition-colors group"
                      >
                        <div className="rounded-lg bg-emerald-500/20 p-2">
                          <CheckCircle className="h-4 w-4 text-emerald-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-slate-800 truncate group-hover:text-primary-400 transition-colors">
                            {pub.title}
                          </p>
                          <p className="text-xs text-slate-500">
                            {pub.doc_type} • {pub.published_at ? formatTimeAgo(pub.published_at) : 'Recently'}
                          </p>
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <ChartEmptyState
                    title="No publications yet"
                    description="Recently published documents will appear here"
                    icon={<BookOpen className="h-8 w-8 text-slate-500" />}
                  />
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
                <div className="rounded-lg bg-cyan-500/20 p-2">
                  <Users className="h-4 w-4 text-cyan-400" />
                </div>
                <h3 className="text-sm font-semibold text-slate-800">Attestation Campaigns</h3>
              </div>
              <div className="p-5">
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 text-center">
                    <p className="text-2xl font-bold text-slate-800">{data.attestations.active_campaigns}</p>
                    <p className="text-xs text-slate-400 mt-1">Active Campaigns</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 text-center">
                    <p className={`text-2xl font-bold ${data.attestations.overdue > 0 ? 'text-red-400' : 'text-slate-800'}`}>
                      {data.attestations.overdue}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">Overdue Responses</p>
                  </div>
                </div>
                {data.attestations.completion_rate > 0 && (
                  <div className="mt-4">
                    <ProgressBar
                      value={data.attestations.completion_rate}
                      label="Completion Rate"
                      color={data.attestations.completion_rate >= 80 ? 'success' : 'warning'}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
                <div className="rounded-lg bg-amber-500/20 p-2">
                  <Scale className="h-4 w-4 text-amber-400" />
                </div>
                <h3 className="text-sm font-semibold text-slate-800">Regulatory Changes</h3>
              </div>
              <div className="p-5">
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="text-center">
                    <p className="text-xl font-bold text-slate-800">{data.regulatory_changes.total_changes}</p>
                    <p className="text-xs text-slate-400">Total</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-bold text-amber-400">{data.regulatory_changes.pending_review}</p>
                    <p className="text-xs text-slate-400">Pending</p>
                  </div>
                  <div className="text-center">
                    <p className={`text-xl font-bold ${data.regulatory_changes.high_impact > 0 ? 'text-red-400' : 'text-slate-800'}`}>
                      {data.regulatory_changes.high_impact}
                    </p>
                    <p className="text-xs text-slate-400">High Impact</p>
                  </div>
                </div>
                {data.regulatory_changes.recent.length > 0 ? (
                  <div className="space-y-2">
                    {data.regulatory_changes.recent.slice(0, 3).map((change: any) => (
                      <div key={change.id} className="flex items-center justify-between p-2 rounded-lg bg-slate-50/50">
                        <span className="text-sm text-slate-600 truncate flex-1">{change.title}</span>
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          change.impact_level === 'high' || change.impact_level === 'critical'
                            ? 'bg-red-500/20 text-red-400'
                            : 'bg-slate-600/50 text-slate-400'
                        }`}>
                          {change.impact_level}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500 text-center py-4">No recent regulatory changes</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'risk' && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KPICard
              title="Total Risks"
              value={data.risk.total_risks}
              subtitle={`${data.risk.open_risks} open`}
              icon={<AlertTriangle className="h-5 w-5 text-amber-400" />}
              color="amber"
            />
            <KPICard
              title="Avg Risk Score"
              value={data.risk.avg_residual_score}
              subtitle="Residual risk"
              icon={<BarChart3 className="h-5 w-5 text-blue-400" />}
              color="blue"
            />
            <KPICard
              title="Open Incidents"
              value={data.risk.incidents_open}
              subtitle={data.risk.incidents_open > 0 ? 'Active investigations' : 'No active incidents'}
              icon={<Flame className="h-5 w-5 text-red-400" />}
              color="red"
            />
            <KPICard
              title="Overdue Mitigations"
              value={data.risk.mitigations_overdue}
              subtitle={data.risk.mitigations_overdue > 0 ? 'Requires action' : 'On track'}
              icon={<Clock className="h-5 w-5 text-primary-600" />}
              color="purple"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-red-500/20 p-2">
                    <Target className="h-4 w-4 text-red-400" />
                  </div>
                  <h3 className="text-sm font-semibold text-slate-800">Risk Heatmap</h3>
                </div>
                <Link href="/erm/risks" className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1">
                  View all <ChevronRight className="h-3 w-3" />
                </Link>
              </div>
              <div className="p-5">
                <RiskHeatmap data={data.risk.heatmap} />
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
                <div className="rounded-lg bg-amber-500/20 p-2">
                  <Layers className="h-4 w-4 text-amber-400" />
                </div>
                <h3 className="text-sm font-semibold text-slate-800">Risk by Category</h3>
              </div>
              <div className="p-5">
                {Object.keys(data.risk.by_category).length > 0 ? (
                  <div className="space-y-3">
                    {Object.entries(data.risk.by_category).slice(0, 6).map(([category, count]) => {
                      const total = Object.values(data.risk.by_category).reduce((a, b) => a + b, 0);
                      const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
                      return (
                        <div key={category}>
                          <div className="flex justify-between items-center text-sm mb-1">
                            <span className="text-slate-600 capitalize">{category.replace(/_/g, ' ')}</span>
                            <span className="text-slate-400">{count} ({percentage}%)</span>
                          </div>
                          <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all duration-300"
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <ChartEmptyState
                    title="No risk categories yet"
                    description="Risk categories will appear as risks are registered"
                    icon={<Layers className="h-8 w-8 text-slate-500" />}
                  />
                )}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-blue-500/20 p-2">
                  <TrendingUp className="h-4 w-4 text-blue-400" />
                </div>
                <h3 className="text-sm font-semibold text-slate-800">Risk Trend</h3>
              </div>
            </div>
            <div className="p-5">
              {riskTrendLabels.length > 0 ? (
                <TrendLine data={riskTrendLabels} color="#f59e0b" height={100} />
              ) : (
                <ChartEmptyState
                  title="No risk trend data yet"
                  description="Risk trends will populate as risk assessments are conducted over time"
                  icon={<TrendingUp className="h-8 w-8 text-slate-500" />}
                />
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-4">
            <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-center">
              <p className="text-2xl font-bold text-red-400">{data.risk.by_score_range.critical}</p>
              <p className="text-xs text-slate-400 mt-1">Critical</p>
            </div>
            <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-4 text-center">
              <p className="text-2xl font-bold text-orange-400">{data.risk.by_score_range.high}</p>
              <p className="text-xs text-slate-400 mt-1">High</p>
            </div>
            <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4 text-center">
              <p className="text-2xl font-bold text-yellow-400">{data.risk.by_score_range.medium}</p>
              <p className="text-xs text-slate-400 mt-1">Medium</p>
            </div>
            <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-4 text-center">
              <p className="text-2xl font-bold text-green-400">{data.risk.by_score_range.low}</p>
              <p className="text-xs text-slate-400 mt-1">Low</p>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'compliance' && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KPICard
              title="Frameworks Tracked"
              value={data.compliance.frameworks_tracked}
              icon={<Shield className="h-5 w-5 text-blue-400" />}
              color="blue"
            />
            <KPICard
              title="Overall Maturity"
              value={`${data.compliance.overall_maturity}%`}
              icon={<Target className="h-5 w-5 text-emerald-400" />}
              color="green"
            />
            <KPICard
              title="Controls Implemented"
              value={`${data.compliance.controls_implemented}/${data.compliance.controls_total}`}
              subtitle={data.compliance.controls_total > 0 
                ? `${Math.round((data.compliance.controls_implemented / data.compliance.controls_total) * 100)}% complete`
                : 'No controls yet'}
              icon={<CheckCircle className="h-5 w-5 text-primary-600" />}
              color="purple"
            />
            <KPICard
              title="Evidence Items"
              value={data.compliance.evidence_items}
              icon={<FileText className="h-5 w-5 text-cyan-400" />}
              color="cyan"
            />
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary-500/20 p-2">
                  <Shield className="h-4 w-4 text-primary-400" />
                </div>
                <h3 className="text-sm font-semibold text-slate-800">Framework Coverage</h3>
              </div>
              <Link href="/frameworks" className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1">
                View all <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="p-5">
              {data.compliance.framework_coverage.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {data.compliance.framework_coverage.map((framework) => (
                    <div
                      key={framework.framework_id}
                      className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 hover:border-slate-300 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium px-2 py-0.5 rounded bg-primary-500/20 text-primary-400">
                            {framework.short_code}
                          </span>
                        </div>
                        <span className={`text-sm px-2 py-0.5 rounded ${
                          framework.status === 'compliant' ? 'bg-emerald-500/20 text-emerald-400' :
                          framework.status === 'partial' ? 'bg-amber-500/20 text-amber-400' :
                          'bg-red-500/20 text-red-400'
                        }`}>
                          {framework.status}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-slate-800 mb-3 truncate" title={framework.name}>
                        {framework.name}
                      </p>
                      <div className="relative pt-1">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-slate-400">
                            {framework.implemented_controls} / {framework.total_controls} controls
                          </span>
                          <span className={`text-sm font-semibold ${
                            framework.score >= 80 ? 'text-emerald-400' :
                            framework.score >= 60 ? 'text-amber-400' : 'text-red-400'
                          }`}>
                            {framework.score}%
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                          <div
                            className={`h-full transition-all duration-500 ${
                              framework.score >= 80 ? 'bg-emerald-500' :
                              framework.score >= 60 ? 'bg-amber-500' : 'bg-red-500'
                            }`}
                            style={{ width: `${framework.score}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <ChartEmptyState
                  title="No frameworks tracked yet"
                  description="Upload compliance frameworks to begin tracking coverage and implementation status"
                  icon={<Shield className="h-8 w-8 text-slate-500" />}
                />
              )}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
                <div className="rounded-lg bg-emerald-500/20 p-2">
                  <Eye className="h-4 w-4 text-emerald-400" />
                </div>
                <h3 className="text-sm font-semibold text-slate-800">Compliance Maturity</h3>
              </div>
              <div className="p-5 flex justify-center">
                {data.compliance.framework_coverage.length > 0 ? (
                  <RadarChart
                    data={data.compliance.framework_coverage.slice(0, 6).map((fw) => ({
                      label: fw.short_code,
                      value: fw.score,
                    }))}
                    size={220}
                  />
                ) : (
                  <ChartEmptyState
                    title="No maturity data yet"
                    description="Framework maturity will be visualized as assessments are completed"
                    icon={<Target className="h-8 w-8 text-slate-500" />}
                  />
                )}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
                <div className="rounded-lg bg-blue-500/20 p-2">
                  <TrendingUp className="h-4 w-4 text-blue-400" />
                </div>
                <h3 className="text-sm font-semibold text-slate-800">Evidence Upload Trend</h3>
              </div>
              <div className="p-5">
                {trendLabels.length > 0 ? (
                  <TrendLine data={trendLabels} color="#10b981" height={150} />
                ) : (
                  <ChartEmptyState
                    title="No evidence trend data yet"
                    description="Evidence trends will populate as documents are uploaded"
                    icon={<TrendingUp className="h-8 w-8 text-slate-500" />}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
