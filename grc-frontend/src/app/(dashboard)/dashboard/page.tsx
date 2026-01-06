'use client';

import { useQuery } from '@tanstack/react-query';
import { dashboardApi, ermApi, vulnManagementApi } from '@/lib/api';
import { ProgressRing, StatusBadge } from '@/components/ui';
import {
  Shield,
  AlertTriangle,
  Bug,
  ClipboardCheck,
  Upload,
  Plus,
  PlayCircle,
  FileText,
  Clock,
  CheckCircle,
  TrendingUp,
  AlertCircle,
  Calendar,
  ArrowRight,
  Activity,
  Target,
  Zap,
} from 'lucide-react';
import Link from 'next/link';

interface DashboardStats {
  stats: {
    frameworks: number;
    controls: number;
    evidence: number;
    open_risks: number;
    documents: number;
    assets: number;
  };
  compliance_overview: Array<{
    framework: string;
    short_code: string;
    score: number;
    status: string;
    total_controls: number;
    covered_controls: number;
  }>;
  recent_activity: Array<{
    type: string;
    action: string;
    name: string;
    timestamp: string;
    status: string;
  }>;
}

interface VulnDashboard {
  total_vulnerabilities: number;
  by_severity: { critical?: number; high?: number; medium?: number; low?: number; info?: number };
  by_status: Record<string, number>;
  overdue_count: number;
  mttr_days: number | null;
  aging_buckets: { '0-7 days'?: number; '8-30 days'?: number; '31-90 days'?: number; '90+ days'?: number };
  sla_compliance: { [key: string]: { compliance_rate: number } };
}

interface RiskDashboard {
  total_risks: number;
  open_risks: number;
  by_category: Record<string, number>;
  by_status: Record<string, number>;
  by_score_range: Record<string, number>;
  avg_inherent_score: number;
  avg_residual_score: number;
}

function getComplianceColor(score: number): 'success' | 'warning' | 'danger' | 'primary' {
  if (score >= 80) return 'success';
  if (score >= 60) return 'warning';
  if (score >= 40) return 'primary';
  return 'danger';
}

function getRiskColor(score: number): 'success' | 'warning' | 'danger' | 'primary' {
  if (score <= 25) return 'success';
  if (score <= 50) return 'warning';
  if (score <= 75) return 'primary';
  return 'danger';
}

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
    default:
      return 'text-slate-400 bg-slate-500/20';
  }
}

export default function ExecutiveDashboardPage() {
  const { data: dashboardData, isLoading: dashboardLoading } = useQuery({
    queryKey: ['main-dashboard-stats'],
    queryFn: async () => {
      const response = await dashboardApi.getStats();
      return response.data as DashboardStats;
    },
  });

  const { data: riskDashboard, isLoading: riskLoading } = useQuery({
    queryKey: ['risk-dashboard'],
    queryFn: async () => {
      const response = await ermApi.risks.getDashboard();
      return response.data as RiskDashboard;
    },
  });

  const { data: vulnDashboard, isLoading: vulnLoading } = useQuery({
    queryKey: ['vuln-dashboard'],
    queryFn: async () => {
      const response = await vulnManagementApi.dashboard.get();
      return response.data as VulnDashboard;
    },
  });

  const { data: pendingActions } = useQuery({
    queryKey: ['pending-actions'],
    queryFn: async () => {
      const response = await ermApi.mitigationActions.getOverdue();
      return response.data;
    },
  });

  const isLoading = dashboardLoading || riskLoading || vulnLoading;

  if (isLoading) {
    return (
      <div className="space-y-8 animate-pulse">
        <div className="page-header">
          <div className="h-8 w-72 rounded bg-slate-700" />
          <div className="h-5 w-96 rounded bg-slate-700 mt-2" />
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-xl border border-slate-700 bg-surface-800 p-6">
              <div className="h-20 w-20 rounded-full bg-slate-700 mx-auto mb-4" />
              <div className="h-6 w-24 rounded bg-slate-700 mx-auto" />
            </div>
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border border-slate-700 bg-surface-800 p-6">
              <div className="h-6 w-32 rounded bg-slate-700 mb-4" />
              <div className="space-y-3">
                {[1, 2, 3].map((j) => (
                  <div key={j} className="h-12 rounded bg-slate-700" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const stats = dashboardData?.stats || { frameworks: 0, controls: 0, evidence: 0, open_risks: 0, documents: 0, assets: 0 };
  const complianceOverview = dashboardData?.compliance_overview || [];
  const recentActivity = dashboardData?.recent_activity || [];
  const riskData = riskDashboard || { total_risks: 0, open_risks: 0, by_category: {}, by_score_range: {}, avg_residual_score: 0 };
  const vulnData: VulnDashboard = vulnDashboard || { 
    total_vulnerabilities: 0, 
    by_severity: {}, 
    by_status: {},
    overdue_count: 0, 
    mttr_days: null,
    aging_buckets: {}, 
    sla_compliance: {} 
  };

  const overallCompliance = complianceOverview.length > 0
    ? Math.round(complianceOverview.reduce((acc, fw) => acc + fw.score, 0) / complianceOverview.length)
    : 0;

  const riskScore = Math.round(riskData.avg_residual_score || 0);
  
  const totalVulns = vulnData.total_vulnerabilities || 0;
  const criticalVulns = vulnData.by_severity?.critical || 0;
  const highVulns = vulnData.by_severity?.high || 0;

  const pendingActionsCount = pendingActions?.length || 0;
  
  const avgSlaCompliance = Object.values(vulnData.sla_compliance || {}).length > 0
    ? Math.round(
        Object.values(vulnData.sla_compliance).reduce((acc: number, s: any) => acc + (s.compliance_rate || 0), 0) /
        Object.values(vulnData.sla_compliance).length
      )
    : 0;

  const quickActions = [
    { label: 'Upload Evidence', icon: Upload, href: '/evidence', color: 'from-blue-500/20 to-blue-600/10', iconColor: 'text-blue-400' },
    { label: 'Create Risk', icon: Plus, href: '/erm/risks', color: 'from-amber-500/20 to-amber-600/10', iconColor: 'text-amber-400' },
    { label: 'Add Vulnerability', icon: Bug, href: '/vulnerabilities', color: 'from-red-500/20 to-red-600/10', iconColor: 'text-red-400' },
    { label: 'Run Assessment', icon: PlayCircle, href: '/framework-upload/assessment', color: 'from-emerald-500/20 to-emerald-600/10', iconColor: 'text-emerald-400' },
  ];

  return (
    <div className="space-y-8">
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title flex items-center gap-3">
              <div className="rounded-xl bg-gradient-to-br from-primary-500/20 to-primary-600/10 p-2.5">
                <Target className="h-6 w-6 text-primary-400" />
              </div>
              Executive Dashboard
            </h1>
            <p className="page-description mt-1">
              Real-time overview of your GRC posture and compliance status
            </p>
          </div>
          <div className="hidden lg:flex items-center gap-2 text-sm text-slate-400">
            <Clock className="h-4 w-4" />
            Last updated: {new Date().toLocaleTimeString()}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-700 bg-surface-800 p-6 hover:border-primary-500/50 hover:shadow-glow-sm transition-all duration-300 group">
          <div className="flex flex-col items-center text-center">
            <div className="relative mb-4">
              <ProgressRing
                percentage={overallCompliance}
                size={100}
                strokeWidth={8}
                color={getComplianceColor(overallCompliance)}
                showPercentage={true}
                animated={true}
              />
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2">
                <div className="flex items-center gap-1 rounded-full bg-surface-900 px-2 py-0.5 text-xs border border-slate-700">
                  <Shield className="h-3 w-3 text-primary-400" />
                  <span className="text-slate-300">Compliance</span>
                </div>
              </div>
            </div>
            <h3 className="text-sm font-medium text-slate-400">Overall Compliance</h3>
            <p className="text-xs text-slate-500 mt-1">{complianceOverview.length} frameworks tracked</p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-surface-800 p-6 hover:border-amber-500/50 hover:shadow-[0_0_15px_-3px_rgba(245,158,11,0.3)] transition-all duration-300 group">
          <div className="flex flex-col items-center text-center">
            <div className="relative mb-4">
              <ProgressRing
                percentage={100 - riskScore}
                size={100}
                strokeWidth={8}
                color={getRiskColor(riskScore)}
                showPercentage={false}
                animated={true}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className={`text-2xl font-bold ${riskScore <= 25 ? 'text-success-400' : riskScore <= 50 ? 'text-warning-400' : 'text-danger-400'}`}>
                  {riskScore}
                </span>
              </div>
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2">
                <div className="flex items-center gap-1 rounded-full bg-surface-900 px-2 py-0.5 text-xs border border-slate-700">
                  <AlertTriangle className="h-3 w-3 text-amber-400" />
                  <span className="text-slate-300">Risk Score</span>
                </div>
              </div>
            </div>
            <h3 className="text-sm font-medium text-slate-400">Risk Posture</h3>
            <p className="text-xs text-slate-500 mt-1">{riskData.open_risks} open risks</p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-surface-800 p-6 hover:border-red-500/50 hover:shadow-[0_0_15px_-3px_rgba(239,68,68,0.3)] transition-all duration-300">
          <div className="flex items-start gap-4">
            <div className="rounded-xl bg-gradient-to-br from-red-500/20 to-red-600/10 p-3">
              <Bug className="h-6 w-6 text-red-400" />
            </div>
            <div className="flex-1">
              <p className="text-3xl font-bold text-white">{totalVulns}</p>
              <p className="text-sm text-slate-400 mt-1">Open Vulnerabilities</p>
              <div className="flex items-center gap-3 mt-3">
                {criticalVulns > 0 && (
                  <span className="flex items-center gap-1 text-xs">
                    <span className="w-2 h-2 rounded-full bg-red-500" />
                    <span className="text-red-400">{criticalVulns} Critical</span>
                  </span>
                )}
                {highVulns > 0 && (
                  <span className="flex items-center gap-1 text-xs">
                    <span className="w-2 h-2 rounded-full bg-orange-500" />
                    <span className="text-orange-400">{highVulns} High</span>
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-surface-800 p-6 hover:border-purple-500/50 hover:shadow-[0_0_15px_-3px_rgba(168,85,247,0.3)] transition-all duration-300">
          <div className="flex items-start gap-4">
            <div className="rounded-xl bg-gradient-to-br from-purple-500/20 to-purple-600/10 p-3">
              <ClipboardCheck className="h-6 w-6 text-purple-400" />
            </div>
            <div className="flex-1">
              <p className="text-3xl font-bold text-white">{pendingActionsCount}</p>
              <p className="text-sm text-slate-400 mt-1">Pending Actions</p>
              <div className="flex items-center gap-2 mt-3">
                {pendingActionsCount > 0 ? (
                  <span className="flex items-center gap-1 text-xs text-amber-400">
                    <Clock className="h-3 w-3" />
                    Requires attention
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-emerald-400">
                    <CheckCircle className="h-3 w-3" />
                    All clear
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-700 bg-surface-800 overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-700 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary-500/20 p-2">
              <Shield className="h-5 w-5 text-primary-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Compliance Overview</h2>
              <p className="text-sm text-slate-400">Framework compliance status</p>
            </div>
          </div>
          <Link href="/frameworks" className="text-sm text-primary-400 hover:text-primary-300 transition-colors flex items-center gap-1">
            View All <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="p-6">
          {complianceOverview.length === 0 ? (
            <div className="text-center py-8">
              <Shield className="h-12 w-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400">No frameworks configured</p>
              <Link href="/frameworks" className="text-primary-400 hover:text-primary-300 text-sm mt-2 inline-block">
                Add a framework
              </Link>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {complianceOverview.map((framework) => (
                <Link
                  key={framework.short_code}
                  href={`/frameworks`}
                  className="rounded-lg border border-slate-700 bg-surface-900/50 p-4 hover:border-slate-600 hover:bg-surface-900 transition-all duration-200 group"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium px-2 py-0.5 rounded bg-primary-500/20 text-primary-400">
                        {framework.short_code}
                      </span>
                      <span className="text-sm font-medium text-white truncate max-w-[120px]" title={framework.framework}>
                        {framework.framework}
                      </span>
                    </div>
                    <span className={`text-lg font-bold ${framework.score >= 80 ? 'text-emerald-400' : framework.score >= 60 ? 'text-amber-400' : 'text-red-400'}`}>
                      {framework.score}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-700 overflow-hidden mb-2">
                    <div
                      className={`h-full transition-all duration-500 ${framework.score >= 80 ? 'bg-emerald-500' : framework.score >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
                      style={{ width: `${framework.score}%` }}
                    />
                  </div>
                  <p className="text-xs text-slate-500">
                    {framework.covered_controls} / {framework.total_controls} controls implemented
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-700 bg-surface-800 overflow-hidden">
          <div className="flex items-center gap-3 border-b border-slate-700 px-4 py-3">
            <div className="rounded-lg bg-amber-500/20 p-1.5">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">Risk by Category</h3>
          </div>
          <div className="p-4 space-y-3">
            {Object.entries(riskData.by_category || {}).length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-4">No risk data available</p>
            ) : (
              Object.entries(riskData.by_category).slice(0, 5).map(([category, count]) => {
                const total = Object.values(riskData.by_category).reduce((a, b) => a + (b as number), 0) as number;
                const percentage = total > 0 ? Math.round(((count as number) / total) * 100) : 0;
                return (
                  <div key={category} className="group">
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-slate-300 capitalize group-hover:text-white transition-colors">
                        {category.replace(/_/g, ' ')}
                      </span>
                      <span className="text-white font-medium">{count as number}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-700 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all duration-300 group-hover:from-amber-400 group-hover:to-amber-300"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-surface-800 overflow-hidden">
          <div className="flex items-center gap-3 border-b border-slate-700 px-4 py-3">
            <div className="rounded-lg bg-blue-500/20 p-1.5">
              <Calendar className="h-4 w-4 text-blue-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">Vulnerability Aging</h3>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-center hover:border-emerald-500/40 transition-colors">
                <p className="text-xl font-bold text-emerald-400">{vulnData.aging_buckets?.['0-7 days'] || 0}</p>
                <p className="text-xs text-slate-400">0-7 days</p>
              </div>
              <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3 text-center hover:border-yellow-500/40 transition-colors">
                <p className="text-xl font-bold text-yellow-400">{vulnData.aging_buckets?.['8-30 days'] || 0}</p>
                <p className="text-xs text-slate-400">8-30 days</p>
              </div>
              <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-3 text-center hover:border-orange-500/40 transition-colors">
                <p className="text-xl font-bold text-orange-400">{vulnData.aging_buckets?.['31-90 days'] || 0}</p>
                <p className="text-xs text-slate-400">31-90 days</p>
              </div>
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-center hover:border-red-500/40 transition-colors">
                <p className="text-xl font-bold text-red-400">{vulnData.aging_buckets?.['90+ days'] || 0}</p>
                <p className="text-xs text-slate-400">90+ days</p>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between rounded-lg bg-surface-900 p-3 border border-slate-700">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-red-400" />
                <span className="text-sm text-slate-300">Overdue</span>
              </div>
              <span className="text-lg font-bold text-red-400">{vulnData.overdue_count || 0}</span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-surface-800 overflow-hidden">
          <div className="flex items-center gap-3 border-b border-slate-700 px-4 py-3">
            <div className="rounded-lg bg-emerald-500/20 p-1.5">
              <TrendingUp className="h-4 w-4 text-emerald-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">SLA Compliance</h3>
          </div>
          <div className="p-4">
            <div className="flex items-center justify-center mb-4">
              <ProgressRing
                percentage={avgSlaCompliance}
                size={100}
                strokeWidth={10}
                color={avgSlaCompliance >= 80 ? 'success' : avgSlaCompliance >= 60 ? 'warning' : 'danger'}
                label="Overall"
                showPercentage={true}
                animated={true}
              />
            </div>
            <div className="space-y-2">
              {['critical', 'high', 'medium', 'low'].map((severity) => {
                const slaData = vulnData.sla_compliance?.[severity];
                const rate = slaData?.compliance_rate || 0;
                return (
                  <div key={severity} className="flex items-center justify-between text-sm">
                    <span className="capitalize text-slate-400">{severity}</span>
                    <span className={`font-medium ${rate >= 80 ? 'text-emerald-400' : rate >= 60 ? 'text-amber-400' : 'text-red-400'}`}>
                      {rate}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-700 bg-surface-800 overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-cyan-500/20 p-1.5">
                <Activity className="h-4 w-4 text-cyan-400" />
              </div>
              <h3 className="text-sm font-semibold text-white">Recent Activity</h3>
            </div>
            <Link href="/evidence" className="text-xs text-primary-400 hover:text-primary-300 transition-colors">
              View All
            </Link>
          </div>
          <div className="divide-y divide-slate-700/50">
            {recentActivity.length === 0 ? (
              <div className="p-8 text-center">
                <Activity className="h-10 w-10 text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400 text-sm">No recent activity</p>
              </div>
            ) : (
              recentActivity.map((activity, index) => {
                const Icon = getActivityIcon(activity.type);
                const colorClass = getActivityColor(activity.type);
                return (
                  <div
                    key={index}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-surface-900/50 transition-colors"
                  >
                    <div className={`rounded-lg p-2 ${colorClass}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">{activity.name}</p>
                      <p className="text-xs text-slate-500">
                        <span className="capitalize">{activity.type}</span> {activity.action}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={activity.status} size="sm" showIcon={false} />
                      <span className="text-xs text-slate-500 whitespace-nowrap">
                        {formatTimeAgo(activity.timestamp)}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-surface-800 overflow-hidden">
          <div className="flex items-center gap-3 border-b border-slate-700 px-4 py-3">
            <div className="rounded-lg bg-violet-500/20 p-1.5">
              <Zap className="h-4 w-4 text-violet-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">Quick Actions</h3>
          </div>
          <div className="p-4 grid grid-cols-2 gap-3">
            {quickActions.map((action) => (
              <Link
                key={action.label}
                href={action.href}
                className={`flex items-center gap-3 rounded-lg border border-slate-700 bg-gradient-to-br ${action.color} p-4 hover:border-slate-600 hover:scale-[1.02] transition-all duration-200 group`}
              >
                <div className="rounded-lg bg-surface-900/50 p-2 group-hover:bg-surface-900 transition-colors">
                  <action.icon className={`h-5 w-5 ${action.iconColor}`} />
                </div>
                <span className="text-sm font-medium text-white group-hover:text-primary-300 transition-colors">
                  {action.label}
                </span>
              </Link>
            ))}
          </div>

          <div className="border-t border-slate-700 p-4">
            <h4 className="text-sm font-medium text-slate-400 mb-3">Platform Stats</h4>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-xl font-bold text-white">{stats.controls}</p>
                <p className="text-xs text-slate-500">Controls</p>
              </div>
              <div>
                <p className="text-xl font-bold text-white">{stats.evidence}</p>
                <p className="text-xs text-slate-500">Evidence</p>
              </div>
              <div>
                <p className="text-xl font-bold text-white">{stats.assets}</p>
                <p className="text-xs text-slate-500">Assets</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
