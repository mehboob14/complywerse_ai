'use client';

import { useQuery } from '@tanstack/react-query';
import { vulnManagementApi } from '@/lib/api';
import {
  Bug,
  Loader2,
  AlertCircle,
  Clock,
  Shield,
  Server,
  AlertTriangle,
  ChevronRight,
  RefreshCw,
  ExternalLink,
  Target,
  Activity,
  Calendar,
  Timer,
} from 'lucide-react';
import Link from 'next/link';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  Legend,
} from 'recharts';
import { StatCard, ProgressRing, SeverityBadge, DataCard, StatusBadge } from '@/components/ui';
import { useState } from 'react';

interface DashboardData {
  total_vulnerabilities: number;
  by_severity: Record<string, number>;
  by_status: Record<string, number>;
  sla_compliance: Record<string, { total: number; resolved: number; on_time: number; compliance_rate: number }>;
  overdue_count: number;
  mttr_days: number | null;
  aging_buckets: Record<string, number>;
  top_affected_assets: Array<{ asset_id: number; asset_name: string; vulnerability_count: number }>;
  recent_activities: Array<{ id: number; vuln_id: string; title: string; status: string; updated_at: string }>;
}

interface OverdueVuln {
  id: number;
  vuln_id: string;
  title: string;
  severity: string;
  status: string;
  due_date: string;
  days_overdue: number;
  assigned_to: number | null;
  assignee_name: string | null;
}

interface AssetExposure {
  asset_id: number;
  asset_name: string;
  asset_type: string;
  vulnerability_count: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
}

interface DepartmentMetrics {
  department_id: number;
  department_name: string;
  department_code?: string;
  total_vulnerabilities: number;
  mttr_days: number | null;
  open_count: number;
  resolved_count: number;
  sla_compliance_percent: number;
  current_workload: number;
  overdue_count: number;
  by_severity: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
}

interface SLATrend {
  date: string;
  compliance_rate: number;
  total_resolved: number;
  on_time: number;
}

interface WorkflowMetrics {
  state: string;
  count: number;
  percentage: number;
}

interface ControlCoverage {
  total_vulnerabilities: number;
  with_controls: number;
  coverage_percentage: number;
  control_effectiveness: number;
}

interface SLAComplianceTrend {
  period: string;
  date: string;
  compliance_percent: number | null;
  resolved_count: number;
  department_id: number;
  department_name: string;
}

interface DepartmentWorkload {
  department_id: number;
  department_name: string;
  department_code: string;
  assigned_count: number;
  in_progress_count: number;
  pending_review_count: number;
  overdue_count: number;
}

interface AgingByDepartment {
  department_id: number;
  department_name: string;
  bucket_0_7: number;
  bucket_8_30: number;
  bucket_31_90: number;
  bucket_90_plus: number;
  total: number;
}

interface EscalationMetrics {
  department_id: number;
  department_name: string;
  total_escalations: number;
  level_1_count: number;
  level_2_count: number;
  level_3_count: number;
  avg_resolution_after_escalation_days: number | null;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#3b82f6',
  info: '#64748b',
};

const SEVERITY_BG: Record<string, string> = {
  critical: 'bg-red-500/20',
  high: 'bg-orange-500/20',
  medium: 'bg-yellow-500/20',
  low: 'bg-blue-500/20',
  info: 'bg-slate-500/20',
};

const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number; payload: { percentage: number } }> }) => {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-lg border border-slate-700 bg-surface-900 px-3 py-2 shadow-lg">
        <p className="text-sm font-medium text-white capitalize">{payload[0].name}</p>
        <p className="text-xs text-slate-400">
          {payload[0].value} vulnerabilities ({payload[0].payload.percentage}%)
        </p>
      </div>
    );
  }
  return null;
};

const AgingTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) => {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-lg border border-slate-700 bg-surface-900 px-3 py-2 shadow-lg">
        <p className="text-sm font-medium text-white">{label}</p>
        <p className="text-xs text-slate-400">{payload[0].value} vulnerabilities</p>
      </div>
    );
  }
  return null;
};

export default function VulnerabilityDashboardPage() {
  const [selectedSeverity, setSelectedSeverity] = useState<string | null>(null);

  const { data: dashboard, isLoading: dashLoading, refetch: refetchDashboard } = useQuery({
    queryKey: ['vuln-dashboard'],
    queryFn: async () => {
      const response = await vulnManagementApi.dashboard.get();
      return response.data as DashboardData;
    },
    refetchInterval: 60000,
  });

  const { data: overdue, isLoading: overdueLoading } = useQuery({
    queryKey: ['vuln-overdue'],
    queryFn: async () => {
      const response = await vulnManagementApi.dashboard.getOverdue();
      return response.data as OverdueVuln[];
    },
    refetchInterval: 60000,
  });

  const { data: assetExposure, isLoading: assetLoading } = useQuery({
    queryKey: ['vuln-asset-exposure'],
    queryFn: async () => {
      const response = await vulnManagementApi.dashboard.getAssetExposure();
      return response.data as AssetExposure[];
    },
    refetchInterval: 60000,
  });

  const { data: departmentMetrics } = useQuery({
    queryKey: ['vuln-department-metrics'],
    queryFn: async () => {
      const response = await vulnManagementApi.dashboard.getDepartmentMetrics();
      return response.data as DepartmentMetrics[];
    },
    refetchInterval: 60000,
  });

  const { data: slaTrends } = useQuery({
    queryKey: ['vuln-sla-trends'],
    queryFn: async () => {
      const response = await vulnManagementApi.dashboard.getSLATrends();
      return response.data as SLATrend[];
    },
    refetchInterval: 60000,
  });

  const { data: workflowMetrics } = useQuery({
    queryKey: ['vuln-workflow-metrics'],
    queryFn: async () => {
      const response = await vulnManagementApi.dashboard.getWorkflowMetrics();
      return response.data as WorkflowMetrics[];
    },
    refetchInterval: 60000,
  });

  const { data: controlCoverage } = useQuery({
    queryKey: ['vuln-control-coverage'],
    queryFn: async () => {
      const response = await vulnManagementApi.dashboard.getControlCoverage();
      return response.data as ControlCoverage;
    },
    refetchInterval: 60000,
  });

  const { data: slaComplianceTrends } = useQuery({
    queryKey: ['vuln-sla-compliance-trends'],
    queryFn: async () => {
      const response = await vulnManagementApi.dashboard.getSLAComplianceTrends(12);
      return response.data as { trends: SLAComplianceTrend[]; summary: Record<string, number> };
    },
    refetchInterval: 60000,
  });

  const { data: departmentWorkload } = useQuery({
    queryKey: ['vuln-department-workload'],
    queryFn: async () => {
      const response = await vulnManagementApi.dashboard.getDepartmentWorkload();
      return response.data as { workload: DepartmentWorkload[] };
    },
    refetchInterval: 60000,
  });

  const { data: agingByDepartment } = useQuery({
    queryKey: ['vuln-aging-by-department'],
    queryFn: async () => {
      const response = await vulnManagementApi.dashboard.getAgingByDepartment();
      return response.data as { aging: AgingByDepartment[] };
    },
    refetchInterval: 60000,
  });

  const { data: escalationMetrics } = useQuery({
    queryKey: ['vuln-escalation-metrics'],
    queryFn: async () => {
      const response = await vulnManagementApi.dashboard.getEscalationMetrics();
      return response.data as { escalations: EscalationMetrics[]; summary: Record<string, number> };
    },
    refetchInterval: 60000,
  });

  if (dashLoading) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary-400 mx-auto mb-4" />
          <p className="text-slate-400">Loading vulnerability data...</p>
        </div>
      </div>
    );
  }

  const totalVulns = dashboard?.total_vulnerabilities || 0;
  const byStatus = dashboard?.by_status || {};
  const openCount = (byStatus['open'] || 0) + (byStatus['in_progress'] || 0);
  const criticalHighCount = (dashboard?.by_severity?.['critical'] || 0) + (dashboard?.by_severity?.['high'] || 0);
  const resolvedCount = byStatus['resolved'] || 0;
  const inProgressCount = byStatus['in_progress'] || 0;

  const overallSLACompliance = (() => {
    const compliance = dashboard?.sla_compliance || {};
    const totalResolved = Object.values(compliance).reduce((sum, c) => sum + c.resolved, 0);
    const totalOnTime = Object.values(compliance).reduce((sum, c) => sum + c.on_time, 0);
    return totalResolved > 0 ? Math.round((totalOnTime / totalResolved) * 100) : 0;
  })();

  const severityData = Object.entries(dashboard?.by_severity || {})
    .filter(([, count]) => count > 0)
    .map(([severity, count]) => ({
      name: severity,
      value: count,
      percentage: totalVulns > 0 ? Math.round((count / totalVulns) * 100) : 0,
      color: SEVERITY_COLORS[severity] || '#64748b',
    }))
    .sort((a, b) => {
      const order = ['critical', 'high', 'medium', 'low', 'info'];
      return order.indexOf(a.name) - order.indexOf(b.name);
    });

  const agingData = Object.entries(dashboard?.aging_buckets || {}).map(([bucket, count]) => ({
    name: bucket,
    value: count,
    fill: bucket === '90+ days' ? '#ef4444' : bucket === '31-90 days' ? '#f97316' : bucket === '8-30 days' ? '#eab308' : '#22c55e',
  }));

  const statusData = [
    { name: 'Open', value: byStatus['open'] || 0, color: '#ef4444' },
    { name: 'In Progress', value: inProgressCount, color: '#eab308' },
    { name: 'Resolved', value: resolvedCount, color: '#22c55e' },
  ].filter(d => d.value > 0);

  const remediationProgress = totalVulns > 0 ? Math.round((resolvedCount / totalVulns) * 100) : 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Vulnerability Dashboard</h1>
          <p className="mt-1 text-slate-400">Real-time security posture and vulnerability metrics</p>
        </div>
        <button
          onClick={() => refetchDashboard()}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-600 bg-surface-800 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Open Vulnerabilities"
          value={openCount}
          icon={Bug}
          variant="info"
          trend={{ direction: openCount > 0 ? 'up' : 'neutral', value: 0, inverted: true }}
          subtitle={`${totalVulns} total tracked`}
        />
        <StatCard
          title="Critical/High"
          value={criticalHighCount}
          icon={AlertTriangle}
          variant="danger"
          subtitle="Immediate attention required"
        />
        <StatCard
          title="Mean Time to Remediate"
          value={dashboard?.mttr_days !== null ? `${dashboard?.mttr_days} days` : '-'}
          icon={Clock}
          variant="default"
          subtitle="Average resolution time"
        />
        <div className="rounded-xl border border-slate-700 bg-surface-800 p-4 hover:border-primary-500/50 hover:shadow-glow-sm transition-all duration-200">
          <div className="flex items-center gap-4">
            <ProgressRing
              percentage={overallSLACompliance}
              size={70}
              color={overallSLACompliance >= 80 ? 'success' : overallSLACompliance >= 60 ? 'warning' : 'danger'}
              showPercentage={true}
            />
            <div>
              <p className="text-sm font-medium text-slate-400">SLA Compliance</p>
              <p className="text-lg font-semibold text-white mt-1">
                {overallSLACompliance >= 80 ? 'On Track' : overallSLACompliance >= 60 ? 'At Risk' : 'Critical'}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">{dashboard?.overdue_count || 0} overdue items</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <DataCard
          title="Severity Distribution"
          icon={Shield}
          subtitle="Breakdown by severity level"
        >
          {severityData.length === 0 ? (
            <div className="flex items-center justify-center h-64 text-slate-400">
              No vulnerability data available
            </div>
          ) : (
            <div className="flex flex-col lg:flex-row items-center gap-6">
              <div className="w-full lg:w-1/2 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={severityData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                      onClick={(entry) => setSelectedSeverity(entry.name === selectedSeverity ? null : entry.name)}
                    >
                      {severityData.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={entry.color}
                          opacity={selectedSeverity && selectedSeverity !== entry.name ? 0.3 : 1}
                          className="cursor-pointer transition-opacity duration-200"
                        />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="w-full lg:w-1/2 space-y-2">
                {severityData.map((entry) => (
                  <button
                    key={entry.name}
                    onClick={() => setSelectedSeverity(entry.name === selectedSeverity ? null : entry.name)}
                    className={`w-full flex items-center justify-between p-2.5 rounded-lg transition-all duration-200 ${
                      selectedSeverity === entry.name
                        ? 'bg-slate-700 ring-1 ring-primary-500'
                        : 'bg-slate-700/50 hover:bg-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: entry.color }}
                      />
                      <span className="text-sm font-medium text-white capitalize">{entry.name}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-semibold text-white">{entry.value}</span>
                      <span className="text-xs text-slate-400 ml-2">({entry.percentage}%)</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </DataCard>

        <DataCard
          title="Aging Analysis"
          icon={Calendar}
          subtitle="Vulnerabilities by age bucket"
        >
          {agingData.every(d => d.value === 0) ? (
            <div className="flex items-center justify-center h-64 text-slate-400">
              No aging data available
            </div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={agingData} layout="vertical">
                  <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fill: '#94a3b8', fontSize: 12 }}
                    width={80}
                  />
                  <Tooltip content={<AgingTooltip />} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {agingData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="mt-4 flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              <span className="text-slate-400">SLA Breached: {agingData.find(d => d.name === '90+ days')?.value || 0}</span>
            </span>
            <span className="text-slate-500">
              Total Open: {agingData.reduce((sum, d) => sum + d.value, 0)}
            </span>
          </div>
        </DataCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <DataCard
          title="Remediation Progress"
          icon={Target}
          subtitle="Status breakdown and progress"
        >
          <div className="space-y-6">
            <div className="flex items-center justify-center">
              <ProgressRing
                percentage={remediationProgress}
                size={100}
                strokeWidth={8}
                color={remediationProgress >= 70 ? 'success' : remediationProgress >= 40 ? 'warning' : 'danger'}
                label="Resolved"
              />
            </div>
            <div className="space-y-3">
              {statusData.map((status) => (
                <div key={status.name} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-300">{status.name}</span>
                    <span className="font-medium text-white">{status.value}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-700 overflow-hidden">
                    <div
                      className="h-full transition-all duration-500"
                      style={{
                        width: `${totalVulns > 0 ? (status.value / totalVulns) * 100 : 0}%`,
                        backgroundColor: status.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="pt-4 border-t border-slate-700">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">Resolution Rate</span>
                <span className="font-medium text-white">
                  {totalVulns > 0 ? Math.round((resolvedCount / totalVulns) * 100) : 0}%
                </span>
              </div>
            </div>
          </div>
        </DataCard>

        <DataCard
          title="Top Affected Assets"
          icon={Server}
          subtitle="Assets with most vulnerabilities"
          actionLabel="View All"
          onAction={() => window.location.href = '/assets'}
          loading={assetLoading}
          empty={!assetExposure || assetExposure.length === 0}
          emptyMessage="No asset exposure data"
        >
          <div className="space-y-2">
            {assetExposure?.slice(0, 5).map((asset, index) => (
              <Link
                key={asset.asset_id}
                href={`/assets/${asset.asset_id}`}
                className="flex items-center justify-between p-3 rounded-lg bg-slate-700/50 hover:bg-slate-700 transition-colors group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs font-medium text-slate-500 w-5">#{index + 1}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate group-hover:text-primary-400 transition-colors">
                      {asset.asset_name}
                    </p>
                    <p className="text-xs text-slate-500 truncate">{asset.asset_type}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {asset.critical_count > 0 && (
                    <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-red-500/20 text-red-400">
                      {asset.critical_count}C
                    </span>
                  )}
                  {asset.high_count > 0 && (
                    <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-orange-500/20 text-orange-400">
                      {asset.high_count}H
                    </span>
                  )}
                  <span className="text-xs text-slate-400">{asset.vulnerability_count} total</span>
                  <ChevronRight className="h-4 w-4 text-slate-500 group-hover:text-primary-400 transition-colors" />
                </div>
              </Link>
            ))}
          </div>
        </DataCard>

        <DataCard
          title="Overdue Alerts"
          icon={AlertCircle}
          subtitle="SLA-breached items requiring action"
          actionLabel="View All"
          onAction={() => window.location.href = '/vulnerabilities?status=overdue'}
          loading={overdueLoading}
          empty={!overdue || overdue.length === 0}
          emptyMessage="No overdue vulnerabilities"
          emptyIcon={Timer}
        >
          <div className="space-y-2">
            {overdue?.slice(0, 5).map((vuln) => (
              <Link
                key={vuln.id}
                href={`/vulnerabilities/${vuln.id}`}
                className="block p-3 rounded-lg bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors group"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <SeverityBadge severity={vuln.severity as 'critical' | 'high' | 'medium' | 'low' | 'info'} size="sm" />
                      <span className="text-xs text-red-400 font-medium">
                        {vuln.days_overdue}d overdue
                      </span>
                    </div>
                    <p className="text-sm font-medium text-white truncate group-hover:text-red-300 transition-colors">
                      {vuln.title}
                    </p>
                    {vuln.assignee_name && (
                      <p className="text-xs text-slate-500 mt-1">
                        Assigned: {vuln.assignee_name}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      window.location.href = `/vulnerabilities/${vuln.id}`;
                    }}
                    className="shrink-0 p-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                    title="View Details"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </button>
                </div>
              </Link>
            ))}
          </div>
        </DataCard>
      </div>

      {dashboard?.sla_compliance && Object.keys(dashboard.sla_compliance).length > 0 && (
        <DataCard
          title="SLA Compliance by Severity"
          icon={Activity}
          subtitle="Performance against remediation SLAs"
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {['critical', 'high', 'medium', 'low', 'info'].map((severity) => {
              const compliance = dashboard.sla_compliance[severity];
              if (!compliance) return null;
              const rate = compliance.compliance_rate;
              return (
                <div
                  key={severity}
                  className={`p-4 rounded-lg ${SEVERITY_BG[severity]} border border-slate-700`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-white capitalize">{severity}</span>
                    <span
                      className={`text-sm font-bold ${
                        rate >= 80 ? 'text-green-400' : rate >= 60 ? 'text-yellow-400' : 'text-red-400'
                      }`}
                    >
                      {rate}%
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-700 overflow-hidden mb-2">
                    <div
                      className={`h-full transition-all duration-500 ${
                        rate >= 80 ? 'bg-green-500' : rate >= 60 ? 'bg-yellow-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${rate}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>{compliance.on_time}/{compliance.resolved} on time</span>
                    <span>{compliance.total} total</span>
                  </div>
                </div>
              );
            })}
          </div>
        </DataCard>
      )}

      {dashboard?.recent_activities && dashboard.recent_activities.length > 0 && (
        <DataCard
          title="Recent Activity"
          icon={Activity}
          subtitle="Latest vulnerability updates"
        >
          <div className="divide-y divide-slate-700">
            {dashboard.recent_activities.map((activity) => (
              <Link
                key={activity.id}
                href={`/vulnerabilities/${activity.id}`}
                className="flex items-center justify-between py-3 first:pt-0 last:pb-0 hover:bg-slate-700/30 -mx-4 px-4 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <StatusBadge status={activity.status} size="sm" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{activity.title}</p>
                    <p className="text-xs text-slate-500">{activity.vuln_id}</p>
                  </div>
                </div>
                <span className="text-xs text-slate-400 shrink-0">
                  {activity.updated_at ? new Date(activity.updated_at).toLocaleDateString() : '-'}
                </span>
              </Link>
            ))}
          </div>
        </DataCard>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {departmentMetrics && (departmentMetrics as { departments: DepartmentMetrics[] }).departments?.length > 0 && (
          <DataCard
            title="Department MTTR Performance"
            icon={Timer}
            subtitle="Mean Time to Remediate by department"
          >
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={(departmentMetrics as { departments: DepartmentMetrics[] }).departments.filter(t => t.mttr_days !== null).slice(0, 8)}
                  layout="vertical"
                  margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                  <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={{ stroke: '#475569' }} />
                  <YAxis 
                    type="category" 
                    dataKey="department_name" 
                    tick={{ fill: '#94a3b8', fontSize: 12 }} 
                    axisLine={{ stroke: '#475569' }}
                    width={100}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                    labelStyle={{ color: '#fff' }}
                    formatter={(value: number) => [`${value} days`, 'MTTR']}
                  />
                  <Bar dataKey="mttr_days" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </DataCard>
        )}

        {slaTrends && slaTrends.length > 0 && (
          <DataCard
            title="SLA Compliance Trend"
            icon={Activity}
            subtitle="Compliance rate over time"
          >
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={slaTrends} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis 
                    dataKey="date" 
                    tick={{ fill: '#94a3b8', fontSize: 12 }} 
                    axisLine={{ stroke: '#475569' }}
                    tickFormatter={(value) => {
                      const date = new Date(value);
                      return `${date.getMonth() + 1}/${date.getDate()}`;
                    }}
                  />
                  <YAxis 
                    tick={{ fill: '#94a3b8', fontSize: 12 }} 
                    axisLine={{ stroke: '#475569' }}
                    domain={[0, 100]}
                    tickFormatter={(value) => `${value}%`}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                    labelStyle={{ color: '#fff' }}
                    formatter={(value: number) => [`${value}%`, 'Compliance']}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="compliance_rate" 
                    stroke="#22c55e" 
                    strokeWidth={2}
                    dot={{ fill: '#22c55e', strokeWidth: 2 }}
                    activeDot={{ r: 6, fill: '#22c55e' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </DataCard>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {workflowMetrics && workflowMetrics.length > 0 && (
          <DataCard
            title="Workflow State Distribution"
            icon={Target}
            subtitle="Current vulnerability states"
          >
            <div className="h-64 flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={workflowMetrics}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={70}
                    paddingAngle={2}
                    dataKey="count"
                    nameKey="state"
                  >
                    {workflowMetrics.map((entry, index) => {
                      const colors = ['#22c55e', '#eab308', '#3b82f6', '#8b5cf6', '#ef4444', '#f97316'];
                      return <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />;
                    })}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                    formatter={(value: number, name: string) => [`${value} (${workflowMetrics.find(w => w.state === name)?.percentage || 0}%)`, name]}
                  />
                  <Legend
                    verticalAlign="bottom"
                    height={36}
                    formatter={(value) => <span className="text-xs text-slate-300 capitalize">{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </DataCard>
        )}

        {controlCoverage && (
          <DataCard
            title="Control Coverage"
            icon={Shield}
            subtitle="Vulnerabilities with linked controls"
            className="lg:col-span-2"
          >
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="flex items-center gap-6">
                <ProgressRing
                  percentage={controlCoverage.coverage_percentage}
                  size={100}
                  color={controlCoverage.coverage_percentage >= 70 ? 'success' : controlCoverage.coverage_percentage >= 40 ? 'warning' : 'danger'}
                  showPercentage={true}
                />
                <div>
                  <p className="text-2xl font-bold text-white">{controlCoverage.coverage_percentage}%</p>
                  <p className="text-sm text-slate-400">Coverage Rate</p>
                  <p className="text-xs text-slate-500 mt-1">
                    {controlCoverage.with_controls} of {controlCoverage.total_vulnerabilities} vulns
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-6">
                <ProgressRing
                  percentage={controlCoverage.control_effectiveness}
                  size={100}
                  color={controlCoverage.control_effectiveness >= 70 ? 'success' : controlCoverage.control_effectiveness >= 40 ? 'warning' : 'danger'}
                  showPercentage={true}
                />
                <div>
                  <p className="text-2xl font-bold text-white">{controlCoverage.control_effectiveness}%</p>
                  <p className="text-sm text-slate-400">Control Effectiveness</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Remediation rate with controls
                  </p>
                </div>
              </div>
            </div>
          </DataCard>
        )}
      </div>

      {departmentMetrics && (departmentMetrics as { departments: DepartmentMetrics[] }).departments?.length > 0 && (
        <DataCard
          title="Department SLA Compliance"
          icon={Shield}
          subtitle="SLA performance by department with severity breakdown"
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {(departmentMetrics as { departments: DepartmentMetrics[] }).departments.map((dept) => {
              const compliance = dept.sla_compliance_percent;
              const complianceColor = compliance >= 90 ? 'bg-green-500/20 border-green-500/30' : 
                                      compliance >= 70 ? 'bg-yellow-500/20 border-yellow-500/30' : 
                                      'bg-red-500/20 border-red-500/30';
              const textColor = compliance >= 90 ? 'text-green-400' : 
                               compliance >= 70 ? 'text-yellow-400' : 
                               'text-red-400';
              
              return (
                <div
                  key={dept.department_id}
                  className={`p-4 rounded-lg border ${complianceColor} transition-all hover:scale-[1.02]`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold text-white truncate">{dept.department_name}</h4>
                    <span className={`text-lg font-bold ${textColor}`}>{compliance}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-700 overflow-hidden mb-3">
                    <div
                      className={`h-full transition-all duration-500 ${
                        compliance >= 90 ? 'bg-green-500' : compliance >= 70 ? 'bg-yellow-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${compliance}%` }}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Total:</span>
                      <span className="text-white font-medium">{dept.total_vulnerabilities}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Open:</span>
                      <span className="text-white font-medium">{dept.open_count}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Overdue:</span>
                      <span className={`font-medium ${dept.overdue_count > 0 ? 'text-red-400' : 'text-slate-300'}`}>
                        {dept.overdue_count}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">MTTR:</span>
                      <span className="text-white font-medium">{dept.mttr_days !== null ? `${dept.mttr_days}d` : '-'}</span>
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-slate-700">
                    <div className="flex gap-1.5 flex-wrap">
                      {dept.by_severity.critical > 0 && (
                        <span className="px-1.5 py-0.5 text-xs rounded bg-red-500/20 text-red-400">
                          {dept.by_severity.critical}C
                        </span>
                      )}
                      {dept.by_severity.high > 0 && (
                        <span className="px-1.5 py-0.5 text-xs rounded bg-orange-500/20 text-orange-400">
                          {dept.by_severity.high}H
                        </span>
                      )}
                      {dept.by_severity.medium > 0 && (
                        <span className="px-1.5 py-0.5 text-xs rounded bg-yellow-500/20 text-yellow-400">
                          {dept.by_severity.medium}M
                        </span>
                      )}
                      {dept.by_severity.low > 0 && (
                        <span className="px-1.5 py-0.5 text-xs rounded bg-blue-500/20 text-blue-400">
                          {dept.by_severity.low}L
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </DataCard>
      )}

      {slaComplianceTrends && slaComplianceTrends.trends?.length > 0 && (
        <DataCard
          title="SLA Compliance Trends by Department"
          icon={Activity}
          subtitle="12-week compliance trends across departments"
        >
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis 
                  dataKey="period"
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  axisLine={{ stroke: '#475569' }}
                  allowDuplicatedCategory={false}
                />
                <YAxis 
                  tick={{ fill: '#94a3b8', fontSize: 12 }} 
                  axisLine={{ stroke: '#475569' }}
                  domain={[0, 100]}
                  tickFormatter={(value) => `${value}%`}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                  labelStyle={{ color: '#fff' }}
                  formatter={(value: number | null) => value !== null ? [`${value}%`, 'Compliance'] : ['-', 'No Data']}
                />
                <Legend 
                  verticalAlign="top" 
                  height={36}
                  formatter={(value) => <span className="text-xs text-slate-300">{value}</span>}
                />
                {(() => {
                  const deptNames = [...new Set(slaComplianceTrends.trends.map(t => t.department_name))];
                  const colors = ['#22c55e', '#3b82f6', '#8b5cf6', '#f97316', '#eab308', '#06b6d4'];
                  return deptNames.map((deptName, idx) => {
                    const deptData = slaComplianceTrends.trends
                      .filter(t => t.department_name === deptName && t.compliance_percent !== null)
                      .map(t => ({ period: t.period, compliance: t.compliance_percent }));
                    return (
                      <Line
                        key={deptName}
                        data={deptData}
                        type="monotone"
                        dataKey="compliance"
                        name={deptName}
                        stroke={colors[idx % colors.length]}
                        strokeWidth={2}
                        dot={{ fill: colors[idx % colors.length], strokeWidth: 1, r: 3 }}
                        connectNulls
                      />
                    );
                  });
                })()}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </DataCard>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {departmentWorkload && departmentWorkload.workload?.length > 0 && (
          <DataCard
            title="Department Workload Distribution"
            icon={Target}
            subtitle="Current workload across departments"
          >
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart 
                  data={departmentWorkload.workload} 
                  layout="vertical"
                  margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                  <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={{ stroke: '#475569' }} />
                  <YAxis 
                    type="category" 
                    dataKey="department_name" 
                    tick={{ fill: '#94a3b8', fontSize: 11 }} 
                    axisLine={{ stroke: '#475569' }}
                    width={100}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                    labelStyle={{ color: '#fff' }}
                  />
                  <Legend 
                    verticalAlign="top" 
                    height={36}
                    formatter={(value) => <span className="text-xs text-slate-300 capitalize">{value.replace('_', ' ')}</span>}
                  />
                  <Bar dataKey="assigned_count" name="Assigned" fill="#3b82f6" radius={[0, 2, 2, 0]} stackId="a" />
                  <Bar dataKey="in_progress_count" name="In Progress" fill="#eab308" radius={[0, 2, 2, 0]} stackId="a" />
                  <Bar dataKey="pending_review_count" name="Pending Review" fill="#8b5cf6" radius={[0, 2, 2, 0]} stackId="a" />
                  <Bar dataKey="overdue_count" name="Overdue" fill="#ef4444" radius={[0, 4, 4, 0]} stackId="a" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </DataCard>
        )}

        {agingByDepartment && agingByDepartment.aging?.length > 0 && (
          <DataCard
            title="Aging Analysis by Department"
            icon={Calendar}
            subtitle="Vulnerability age distribution (days open)"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left py-2 px-2 text-slate-400 font-medium">Department</th>
                    <th className="text-center py-2 px-2 text-green-400 font-medium">0-7d</th>
                    <th className="text-center py-2 px-2 text-yellow-400 font-medium">8-30d</th>
                    <th className="text-center py-2 px-2 text-orange-400 font-medium">31-90d</th>
                    <th className="text-center py-2 px-2 text-red-400 font-medium">90+d</th>
                    <th className="text-center py-2 px-2 text-slate-400 font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {agingByDepartment.aging.map((dept) => (
                    <tr key={dept.department_id} className="border-b border-slate-700/50 hover:bg-slate-800/50">
                      <td className="py-2.5 px-2 text-white font-medium truncate max-w-[150px]">{dept.department_name}</td>
                      <td className="py-2.5 px-2 text-center">
                        <span className={`inline-block min-w-[32px] px-2 py-0.5 rounded ${dept.bucket_0_7 > 0 ? 'bg-green-500/20 text-green-400' : 'text-slate-500'}`}>
                          {dept.bucket_0_7}
                        </span>
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        <span className={`inline-block min-w-[32px] px-2 py-0.5 rounded ${dept.bucket_8_30 > 0 ? 'bg-yellow-500/20 text-yellow-400' : 'text-slate-500'}`}>
                          {dept.bucket_8_30}
                        </span>
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        <span className={`inline-block min-w-[32px] px-2 py-0.5 rounded ${dept.bucket_31_90 > 0 ? 'bg-orange-500/20 text-orange-400' : 'text-slate-500'}`}>
                          {dept.bucket_31_90}
                        </span>
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        <span className={`inline-block min-w-[32px] px-2 py-0.5 rounded ${dept.bucket_90_plus > 0 ? 'bg-red-500/20 text-red-400' : 'text-slate-500'}`}>
                          {dept.bucket_90_plus}
                        </span>
                      </td>
                      <td className="py-2.5 px-2 text-center text-white font-semibold">{dept.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DataCard>
        )}
      </div>

      {escalationMetrics && escalationMetrics.escalations?.length > 0 && (
        <DataCard
          title="Escalation Metrics by Department"
          icon={AlertTriangle}
          subtitle="Escalation levels and resolution performance"
        >
          <div className="grid gap-4 mb-6 sm:grid-cols-4">
            <div className="p-4 rounded-lg bg-slate-700/50 border border-slate-600">
              <p className="text-2xl font-bold text-white">{escalationMetrics.summary?.total_escalations || 0}</p>
              <p className="text-sm text-slate-400">Total Escalations</p>
            </div>
            <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
              <p className="text-2xl font-bold text-yellow-400">{escalationMetrics.summary?.level_1_count || 0}</p>
              <p className="text-sm text-slate-400">Level 1</p>
            </div>
            <div className="p-4 rounded-lg bg-orange-500/10 border border-orange-500/30">
              <p className="text-2xl font-bold text-orange-400">{escalationMetrics.summary?.level_2_count || 0}</p>
              <p className="text-sm text-slate-400">Level 2</p>
            </div>
            <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30">
              <p className="text-2xl font-bold text-red-400">{escalationMetrics.summary?.level_3_count || 0}</p>
              <p className="text-sm text-slate-400">Level 3</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left py-2 px-2 text-slate-400 font-medium">Department</th>
                  <th className="text-center py-2 px-2 text-slate-400 font-medium">Total</th>
                  <th className="text-center py-2 px-2 text-yellow-400 font-medium">L1</th>
                  <th className="text-center py-2 px-2 text-orange-400 font-medium">L2</th>
                  <th className="text-center py-2 px-2 text-red-400 font-medium">L3</th>
                  <th className="text-center py-2 px-2 text-slate-400 font-medium">Avg Resolution</th>
                </tr>
              </thead>
              <tbody>
                {escalationMetrics.escalations.map((dept) => (
                  <tr key={dept.department_id} className="border-b border-slate-700/50 hover:bg-slate-800/50">
                    <td className="py-2.5 px-2 text-white font-medium">{dept.department_name}</td>
                    <td className="py-2.5 px-2 text-center text-white">{dept.total_escalations}</td>
                    <td className="py-2.5 px-2 text-center">
                      <span className={`inline-block min-w-[24px] px-1.5 py-0.5 rounded ${dept.level_1_count > 0 ? 'bg-yellow-500/20 text-yellow-400' : 'text-slate-500'}`}>
                        {dept.level_1_count}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-center">
                      <span className={`inline-block min-w-[24px] px-1.5 py-0.5 rounded ${dept.level_2_count > 0 ? 'bg-orange-500/20 text-orange-400' : 'text-slate-500'}`}>
                        {dept.level_2_count}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-center">
                      <span className={`inline-block min-w-[24px] px-1.5 py-0.5 rounded ${dept.level_3_count > 0 ? 'bg-red-500/20 text-red-400' : 'text-slate-500'}`}>
                        {dept.level_3_count}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-center text-slate-300">
                      {dept.avg_resolution_after_escalation_days !== null ? `${dept.avg_resolution_after_escalation_days}d` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataCard>
      )}
    </div>
  );
}
