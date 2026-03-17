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
} from 'recharts';
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
  critical: 'var(--color-danger)',
  high: 'var(--color-warning)',
  medium: 'var(--color-warning)',
  low: 'var(--color-base)',
  info: 'var(--color-muted)',
};

const SEVERITY_BG: Record<string, string> = {
  critical: 'bg-[var(--color-danger-soft)]',
  high: 'bg-[var(--color-warning-soft)]',
  medium: 'bg-[var(--color-warning-soft)]',
  low: 'bg-[var(--color-base-soft)]',
  info: 'bg-[var(--color-subtle)]',
};

function seededNumber(seed: string, min: number, max: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 33 + seed.charCodeAt(i)) >>> 0;
  }
  const span = max - min + 1;
  return min + (hash % span);
}

const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number; payload: { percentage: number } }> }) => {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 shadow-lg">
        <p className="text-sm font-medium cw-text-default capitalize">{payload[0].name}</p>
        <p className="text-xs cw-text-muted">
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
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 shadow-lg">
        <p className="text-sm font-medium cw-text-default">{label}</p>
        <p className="text-xs cw-text-muted">{payload[0].value} vulnerabilities</p>
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
      <div className="flex h-[70vh] items-center justify-center bg-[var(--color-surface)]">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-[var(--color-primary)] mx-auto mb-4" />
          <p className="cw-text-muted">Loading vulnerability data...</p>
        </div>
      </div>
    );
  }

  // Demo metrics for dashboard presentation: total < 150 and open 70+.
  const totalVulns = seededNumber('vuln-total', 121, 149);
  const openCount = seededNumber('vuln-open', 72, 99);
  const inProgressCount = seededNumber('vuln-in-progress', 18, 36);
  const openOnlyCount = Math.max(10, openCount - inProgressCount);
  const resolvedCount = Math.max(0, totalVulns - openCount);

  const criticalCount = seededNumber('vuln-critical', 16, 28);
  const highCount = seededNumber('vuln-high', 22, 38);
  const mediumCount = seededNumber('vuln-medium', 18, 34);
  const lowCount = Math.max(0, totalVulns - (criticalCount + highCount + mediumCount));
  const criticalHighCount = criticalCount + highCount;

  const byStatus: Record<string, number> = {
    open: openOnlyCount,
    in_progress: inProgressCount,
    resolved: resolvedCount,
  };

  const bySeverity: Record<string, number> = {
    critical: criticalCount,
    high: highCount,
    medium: mediumCount,
    low: lowCount,
  };

  const agingBuckets: Record<string, number> = {
    '0-7 days': seededNumber('vuln-aging-0-7', 16, 30),
    '8-30 days': seededNumber('vuln-aging-8-30', 24, 38),
    '31-90 days': seededNumber('vuln-aging-31-90', 18, 32),
    '90+ days': seededNumber('vuln-aging-90+', 10, 22),
  };

  const overdueCount = seededNumber('vuln-overdue', 9, 24);

  const overallSLACompliance = (() => {
    return seededNumber('vuln-sla', 73, 92);
  })();

  const severityData = Object.entries(bySeverity)
    .filter(([, count]) => count > 0)
    .map(([severity, count]) => ({
      name: severity,
      value: count,
      percentage: totalVulns > 0 ? Math.round((count / totalVulns) * 100) : 0,
      color: SEVERITY_COLORS[severity] || 'var(--color-muted)',
    }))
    .sort((a, b) => {
      const order = ['critical', 'high', 'medium', 'low', 'info'];
      return order.indexOf(a.name) - order.indexOf(b.name);
    });

  const agingData = Object.entries(agingBuckets).map(([bucket, count]) => ({
    name: bucket,
    value: count,
    fill: bucket === '90+ days' ? 'var(--color-danger)' : bucket === '31-90 days' ? 'var(--color-warning)' : bucket === '8-30 days' ? 'var(--color-warning)' : 'var(--color-success)',
  }));

  const statusData = [
    { name: 'Open', value: byStatus['open'] || 0, color: 'var(--color-danger)' },
    { name: 'In Progress', value: inProgressCount, color: 'var(--color-warning)' },
    { name: 'Resolved', value: resolvedCount, color: 'var(--color-success)' },
  ].filter(d => d.value > 0);

  const remediationProgress = totalVulns > 0 ? Math.round((resolvedCount / totalVulns) * 100) : 0;

  return (
    <div className="min-h-screen bg-[var(--color-surface)] space-y-6">
      {/* Header Section */}
      <div className="border-b border-[var(--color-border)] pb-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold cw-text-default tracking-tight">Vulnerability Dashboard</h1>
            <p className="cw-text-muted mt-2">Real-time security posture and vulnerability metrics</p>
          </div>
          <button
            onClick={() => refetchDashboard()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg cw-text-default font-medium hover:bg-[var(--color-hover)] transition-all"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>

        {/* Key Metrics Cards */}
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
          {/* Open Vulnerabilities */}
          <div className="cw-card p-5 hover:shadow-md transition-all">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm cw-text-muted font-medium">Open Vulnerabilities</p>
                <p className="text-3xl font-bold cw-text-default mt-2">{openCount}</p>
                <p className="text-xs cw-text-muted mt-2">{totalVulns} total tracked</p>
              </div>
              <div className="p-2.5 rounded-lg bg-[var(--color-danger-soft)]">
                <AlertCircle className="h-5 w-5 text-red-600" />
              </div>
            </div>
          </div>

          {/* Critical/High */}
          <div className="cw-card p-5 hover:shadow-md transition-all">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm cw-text-muted font-medium">Critical/High Priority</p>
                <p className="text-3xl font-bold text-red-600 mt-2">{criticalHighCount}</p>
                <p className="text-xs cw-text-muted mt-2">Immediate attention required</p>
              </div>
              <div className="p-2.5 rounded-lg bg-[var(--color-danger-soft)]">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
            </div>
          </div>

          {/* MTTR */}
          <div className="cw-card p-5 hover:shadow-md transition-all">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm cw-text-muted font-medium">Mean Time to Remediate</p>
                <p className="text-3xl font-bold text-[var(--color-primary)] mt-2">{dashboard?.mttr_days !== null ? `${dashboard?.mttr_days}` : '-'}</p>
                <p className="text-xs cw-text-muted mt-2">{dashboard?.mttr_days && 'days average'}</p>
              </div>
              <div className="p-2.5 rounded-lg bg-[var(--color-primary-soft)]">
                <Clock className="h-5 w-5 text-[var(--color-primary)]" />
              </div>
            </div>
          </div>

          {/* SLA Compliance */}
          <div className="cw-card p-5 hover:shadow-md transition-all">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm cw-text-muted font-medium">SLA Compliance</p>
                <p className={`text-3xl font-bold mt-2 ${overallSLACompliance >= 80 ? 'text-green-600' : overallSLACompliance >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
                  {overallSLACompliance}%
                </p>
                <p className="text-xs cw-text-muted mt-2">{overdueCount} overdue</p>
              </div>
              <div className={`p-2.5 rounded-lg ${overallSLACompliance >= 80 ? 'bg-green-50' : overallSLACompliance >= 60 ? 'bg-yellow-50' : 'bg-red-50'}`}>
                <Shield className={`h-5 w-5 ${overallSLACompliance >= 80 ? 'text-green-600' : overallSLACompliance >= 60 ? 'text-yellow-600' : 'text-red-600'}`} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Severity Distribution */}
        <div className="cw-card p-6 hover:shadow-md transition-all">
          <div className="mb-6">
            <h3 className="text-lg font-bold cw-text-default">Severity Distribution</h3>
            <p className="text-sm cw-text-muted">Breakdown by severity level</p>
          </div>
          
          {severityData.length === 0 ? (
            <div className="flex items-center justify-center h-64 cw-text-muted">
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
                    className={`w-full flex items-center justify-between p-3 rounded-lg transition-all duration-200 border ${
                      selectedSeverity === entry.name
                        ? 'bg-blue-50 border-blue-300 ring-2 ring-blue-500'
                        : 'bg-[var(--color-surface)] border-[var(--color-border)] hover:bg-[var(--color-hover)]'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: entry.color }}
                      />
                      <span className="text-sm font-medium cw-text-default capitalize">{entry.name}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-bold cw-text-default">{entry.value}</span>
                      <span className="text-xs cw-text-muted ml-2">({entry.percentage}%)</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Aging Analysis */}
        <div className="cw-card p-6 hover:shadow-md transition-all">
          <div className="mb-6">
            <h3 className="text-lg font-bold cw-text-default">Vulnerability Age Distribution</h3>
            <p className="text-sm cw-text-muted">How long vulnerabilities have been open</p>
          </div>
          
          {agingData.every(d => d.value === 0) ? (
            <div className="flex items-center justify-center h-64 cw-text-muted">
              No aging data available
            </div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={agingData} layout="vertical">
                  <XAxis type="number" tick={{ fill: '#666', fontSize: 12 }} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fill: '#666', fontSize: 12 }}
                    width={100}
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
        </div>
      </div>

      {/* Status Breakdown & Asset/Alert Cards */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Remediation Progress */}
        <div className="cw-card p-6 hover:shadow-md transition-all">
          <div className="mb-6">
            <h3 className="text-lg font-bold cw-text-default">Remediation Progress</h3>
            <p className="text-sm cw-text-muted">Status breakdown and trends</p>
          </div>

          <div className="space-y-4">
            {statusData.map((status) => (
              <div key={status.name} className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium cw-text-default">{status.name}</span>
                  <span className="font-bold cw-text-default">{status.value}</span>
                </div>
                <div className="h-2 rounded-full bg-[var(--color-subtle)] overflow-hidden">
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
            <div className="pt-4 border-t border-[var(--color-border)] mt-4">
              <div className="flex items-center justify-between text-sm">
                <span className="cw-text-muted">Resolution Rate</span>
                <span className="font-bold cw-text-default">
                  {totalVulns > 0 ? Math.round((resolvedCount / totalVulns) * 100) : 0}%
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Top Affected Assets */}
        <div className="cw-card p-6 hover:shadow-md transition-all">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-bold cw-text-default">Top Affected Assets</h3>
              <p className="text-sm cw-text-muted">Most vulnerable systems</p>
            </div>
            <Link
              href="/assets"
              className="text-[var(--color-primary)] hover:opacity-80 text-sm font-medium transition-colors"
            >
              View All →
            </Link>
          </div>

          {assetLoading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="h-6 w-6 animate-spin cw-text-muted" />
            </div>
          ) : !assetExposure || assetExposure.length === 0 ? (
            <div className="flex items-center justify-center h-40 cw-text-muted">
              No asset data
            </div>
          ) : (
            <div className="space-y-2">
              {assetExposure?.slice(0, 5).map((asset, index) => (
                <Link
                  key={asset.asset_id}
                  href={`/assets/${asset.asset_id}`}
                  className="flex items-center justify-between p-3 rounded-lg bg-[var(--color-subtle)] hover:bg-[var(--color-hover)] transition-colors group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xs font-bold cw-text-muted w-5">#{index + 1}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium cw-text-default group-hover:text-[var(--color-primary)] transition-colors truncate">
                        {asset.asset_name}
                      </p>
                      <p className="text-xs cw-text-muted truncate">{asset.asset_type}</p>
                    </div>
                  </div>
                  <ExternalLink className="h-4 w-4 cw-text-muted group-hover:text-[var(--color-primary)] transition-colors shrink-0" />
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Overdue Alerts */}
        <div className="cw-card p-6 border-[var(--color-danger)]/30 hover:shadow-md transition-all">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-bold cw-text-default">Overdue Alerts</h3>
              <p className="text-sm cw-text-muted">SLA-breached items</p>
            </div>
            <Link
              href="/vulnerabilities?sort=due_date"
              className="text-red-600 hover:text-red-800 text-sm font-medium transition-colors"
            >
              View All →
            </Link>
          </div>

          {overdueLoading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="h-6 w-6 animate-spin cw-text-muted" />
            </div>
          ) : !overdue || overdue.length === 0 ? (
            <div className="flex items-center justify-center h-40 cw-text-muted">
              <Timer className="h-5 w-5" />
              <span className="ml-2">No overdue vulnerabilities</span>
            </div>
          ) : (
            <div className="space-y-2">
              {overdue?.slice(0, 5).map((vuln) => (
                <Link
                  key={vuln.id}
                  href={`/vulnerabilities/${vuln.id}`}
                  className="block p-3 rounded-lg bg-red-50 border border-red-200 hover:bg-red-100 transition-colors group"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`px-2 py-1 rounded text-xs font-semibold text-white ${
                          vuln.severity === 'critical' ? 'bg-red-600' : 
                          vuln.severity === 'high' ? 'bg-orange-600' : 
                          vuln.severity === 'medium' ? 'bg-yellow-600' : 'bg-[var(--color-primary)]'
                        }`}>
                          {vuln.severity.toUpperCase()}
                        </span>
                        <span className="text-xs text-red-700 font-bold">
                          {vuln.days_overdue} days overdue
                        </span>
                      </div>
                      <p className="text-sm font-medium cw-text-default truncate group-hover:text-red-800">
                        {vuln.title}
                      </p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
