'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import {
  AlertTriangle,
  Shield,
  CheckCircle,
  XCircle,
  FileWarning,
  Download,
  Filter,
  Loader2,
  AlertCircle,
  ArrowRight,
  Plus,
  Upload,
  ChevronDown,
  BarChart3,
  PieChart as PieChartIcon,
  Layers,
  FileText,
  ExternalLink,
  TrendingDown,
  Target,
} from 'lucide-react';
import Link from 'next/link';
import { StatCard, ProgressRing, SeverityBadge, DataCard } from '@/components/ui';
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
  Legend,
} from 'recharts';

interface DashboardData {
  total_controls: number;
  mapped_controls: number;
  unmapped_controls: number;
  mapping_percentage: number;
  controls_with_evidence: number;
  controls_without_evidence: number;
  evidence_coverage_percentage: number;
  coverage_by_framework: FrameworkCoverage[];
  critical_gaps: CriticalGap[];
}

interface FrameworkCoverage {
  framework_id: number;
  framework_name: string;
  framework_code: string;
  total_controls: number;
  controls_with_evidence: number;
  controls_without_evidence: number;
  coverage_percentage: number;
  framework_type?: string;
}

interface CriticalGap {
  type: string;
  priority: string;
  description: string;
  framework_id?: number;
  recommendation_id?: number;
  details: Record<string, any>;
}

interface ControlData {
  id: number;
  code: string;
  name: string;
  statement?: string;
  control_type: string;
  framework?: {
    id: number;
    name: string;
    short_code: string;
  };
  evidence_count?: number;
  has_evidence?: boolean;
}

interface UnmappedControlsResponse {
  total: number;
  total_normalized: number;
  total_framework: number;
  controls: ControlData[];
}

interface EvidenceGapsResponse {
  total: number;
  controls_with_gaps: Array<ControlData & {
    missing_evidence_types: Array<{
      evidence_type: string;
      priority: string;
      description: string;
    }>;
    missing_count: number;
  }>;
}

interface FrameworkGapsResponse {
  framework_id: number;
  framework_name: string;
  framework_code: string;
  total_controls: number;
  summary: {
    unmapped_controls_count: number;
    no_evidence_count: number;
    low_coverage_count: number;
  };
  unmapped_controls: ControlData[];
  no_evidence_controls: ControlData[];
  low_coverage_controls: ControlData[];
}

const TABS = [
  { id: 'unmapped', label: 'Unmapped Controls', icon: Layers },
  { id: 'no-evidence', label: 'Without Evidence', icon: FileWarning },
  { id: 'evidence-gaps', label: 'Evidence Gaps', icon: AlertTriangle },
];

const COLORS = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#f59e0b',
  low: '#3b82f6',
  green: '#22c55e',
  purple: '#a855f7',
  cyan: '#06b6d4',
};

export default function GapAnalysisDashboardPage() {
  const [activeTab, setActiveTab] = useState('unmapped');
  const [selectedFrameworkId, setSelectedFrameworkId] = useState<number | null>(null);
  const [selectedFrameworkType, setSelectedFrameworkType] = useState<string | null>(null);
  const [showFrameworkDrillDown, setShowFrameworkDrillDown] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  const { data: dashboard, isLoading: dashboardLoading } = useQuery({
    queryKey: ['gap-analysis-dashboard'],
    queryFn: async () => {
      const response = await apiClient.get('/control-library/gap-analysis/dashboard');
      return response.data as DashboardData;
    },
  });

  const { data: unmappedControls, isLoading: unmappedLoading } = useQuery({
    queryKey: ['unmapped-controls', selectedFrameworkId],
    queryFn: async () => {
      const params: Record<string, any> = { limit: 100 };
      if (selectedFrameworkId) params.framework_id = selectedFrameworkId;
      const response = await apiClient.get('/control-library/gap-analysis/unmapped-controls', { params });
      return response.data as UnmappedControlsResponse;
    },
  });

  const { data: controlsWithoutEvidence, isLoading: noEvidenceLoading } = useQuery({
    queryKey: ['controls-without-evidence', selectedFrameworkId],
    queryFn: async () => {
      const params: Record<string, any> = { limit: 100 };
      if (selectedFrameworkId) params.framework_id = selectedFrameworkId;
      const response = await apiClient.get('/control-library/gap-analysis/controls-without-evidence', { params });
      return response.data as UnmappedControlsResponse;
    },
  });

  const { data: evidenceGaps, isLoading: evidenceGapsLoading } = useQuery({
    queryKey: ['evidence-gaps'],
    queryFn: async () => {
      const response = await apiClient.get('/control-library/gap-analysis/evidence-gaps', {
        params: { limit: 100 }
      });
      return response.data as EvidenceGapsResponse;
    },
  });

  const { data: frameworkGaps, isLoading: frameworkGapsLoading } = useQuery({
    queryKey: ['framework-gaps', selectedFrameworkId, selectedFrameworkType],
    queryFn: async () => {
      if (!selectedFrameworkId) return null;
      const response = await apiClient.get(`/control-library/gap-analysis/framework-gaps/${selectedFrameworkId}`, {
        params: { framework_type: selectedFrameworkType || undefined }
      });
      return response.data as FrameworkGapsResponse;
    },
    enabled: !!selectedFrameworkId && showFrameworkDrillDown,
  });

  const gapSeverityData = useMemo(() => {
    if (!dashboard?.critical_gaps) return [];
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    dashboard.critical_gaps.forEach(gap => {
      const priority = gap.priority.toLowerCase() as keyof typeof counts;
      if (priority in counts) counts[priority]++;
    });
    return [
      { name: 'Critical', value: counts.critical, color: COLORS.critical },
      { name: 'High', value: counts.high, color: COLORS.high },
      { name: 'Medium', value: counts.medium, color: COLORS.medium },
      { name: 'Low', value: counts.low, color: COLORS.low },
    ].filter(d => d.value > 0);
  }, [dashboard]);

  const frameworkChartData = useMemo(() => {
    if (!dashboard?.coverage_by_framework) return [];
    return dashboard.coverage_by_framework.map(fw => ({
      name: fw.framework_code,
      fullName: fw.framework_name,
      covered: fw.controls_with_evidence,
      uncovered: fw.controls_without_evidence,
      coverage: fw.coverage_percentage,
    }));
  }, [dashboard]);

  const exportMutation = useMutation({
    mutationFn: async (format: 'json' | 'csv') => {
      const response = await apiClient.post('/control-library/gap-analysis/export', {
        format,
        include_details: true,
      }, {
        responseType: format === 'csv' ? 'blob' : 'json',
      });
      return { data: response.data, format };
    },
    onSuccess: ({ data, format }) => {
      if (format === 'csv') {
        const blob = new Blob([data], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gap_analysis_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
      } else {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gap_analysis_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        window.URL.revokeObjectURL(url);
      }
      setShowExportMenu(false);
    },
  });

  const handleFrameworkClick = (frameworkId: number, frameworkType?: string) => {
    setSelectedFrameworkId(frameworkId);
    setSelectedFrameworkType(frameworkType || null);
    setShowFrameworkDrillDown(true);
  };

  const getCoverageColor = (percentage: number) => {
    if (percentage >= 80) return 'bg-green-500';
    if (percentage >= 50) return 'bg-yellow-500';
    if (percentage >= 20) return 'bg-orange-500';
    return 'bg-red-500';
  };

  const getCoverageTextColor = (percentage: number) => {
    if (percentage >= 80) return 'text-green-400';
    if (percentage >= 50) return 'text-yellow-400';
    if (percentage >= 20) return 'text-orange-400';
    return 'text-red-400';
  };

  if (dashboardLoading) {
    return (
      <div className="space-y-8">
        <div className="page-header">
          <div className="skeleton h-8 w-64 mb-2" />
          <div className="skeleton h-5 w-96" />
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="stat-card">
              <div className="skeleton h-12 w-12 rounded-xl mb-4" />
              <div className="skeleton h-8 w-20 mb-2" />
              <div className="skeleton h-4 w-32" />
            </div>
          ))}
        </div>
        <div className="card">
          <div className="skeleton h-6 w-48 mb-4" />
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-16 w-full rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const criticalCount = dashboard?.critical_gaps?.filter(g => g.priority === 'critical').length || 0;
  const highCount = dashboard?.critical_gaps?.filter(g => g.priority === 'high').length || 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Gap Analysis Dashboard</h1>
          <p className="text-slate-400">Identify and address control mapping and evidence gaps</p>
        </div>
        <div className="relative">
          <button
            onClick={() => setShowExportMenu(!showExportMenu)}
            className="btn-primary flex items-center gap-2"
            disabled={exportMutation.isPending}
          >
            {exportMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Export Report
            <ChevronDown className="h-4 w-4" />
          </button>
          {showExportMenu && (
            <div className="absolute right-0 top-full z-10 mt-2 w-40 rounded-lg border border-slate-700 bg-slate-800 py-1 shadow-lg">
              <button
                onClick={() => exportMutation.mutate('json')}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-slate-300 hover:bg-slate-700"
              >
                <FileText className="h-4 w-4" />
                Export as JSON
              </button>
              <button
                onClick={() => exportMutation.mutate('csv')}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-slate-300 hover:bg-slate-700"
              >
                <FileText className="h-4 w-4" />
                Export as CSV
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          title="Unmapped Controls"
          value={dashboard?.unmapped_controls || 0}
          icon={Layers}
          variant="warning"
          subtitle={`${dashboard?.mapping_percentage || 0}% mapped`}
        />
        <StatCard
          title="Without Evidence"
          value={dashboard?.controls_without_evidence || 0}
          icon={FileWarning}
          variant="danger"
          subtitle={`${dashboard?.evidence_coverage_percentage || 0}% covered`}
        />
        <StatCard
          title="Critical Gaps"
          value={criticalCount}
          icon={AlertTriangle}
          variant="danger"
          subtitle="Immediate attention"
        />
        <StatCard
          title="High Priority"
          value={highCount}
          icon={TrendingDown}
          variant="warning"
          subtitle="Needs action soon"
        />
        <div className="rounded-xl border border-slate-700 bg-surface-800 p-4 flex items-center justify-center">
          <ProgressRing
            percentage={dashboard?.evidence_coverage_percentage || 0}
            size={80}
            color={dashboard && dashboard.evidence_coverage_percentage >= 67 ? 'success' : dashboard && dashboard.evidence_coverage_percentage >= 34 ? 'warning' : 'danger'}
            label="Coverage"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DataCard
          title="Gap Severity Breakdown"
          subtitle="Distribution of gaps by priority"
          icon={PieChartIcon}
          empty={gapSeverityData.length === 0}
          emptyMessage="No gaps detected"
        >
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={gapSeverityData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                  label={({ name, value }) => `${name}: ${value}`}
                  labelLine={{ stroke: '#64748b' }}
                >
                  {gapSeverityData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ 
                    backgroundColor: '#1e293b', 
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    color: '#fff'
                  }}
                />
                <Legend 
                  wrapperStyle={{ color: '#94a3b8' }}
                  formatter={(value) => <span style={{ color: '#94a3b8' }}>{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </DataCard>

        <DataCard
          title="Framework Coverage"
          subtitle="Evidence coverage by framework"
          icon={BarChart3}
          empty={frameworkChartData.length === 0}
          emptyMessage="No framework data"
        >
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={frameworkChartData} layout="vertical">
                <XAxis type="number" domain={[0, 100]} tick={{ fill: '#94a3b8' }} />
                <YAxis dataKey="name" type="category" tick={{ fill: '#94a3b8' }} width={80} />
                <Tooltip
                  contentStyle={{ 
                    backgroundColor: '#1e293b', 
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    color: '#fff'
                  }}
                  formatter={(value: number) => [`${value}%`, 'Coverage']}
                />
                <Bar dataKey="coverage" radius={[0, 4, 4, 0]}>
                  {frameworkChartData.map((entry, index) => (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={entry.coverage >= 80 ? COLORS.green : entry.coverage >= 50 ? COLORS.medium : COLORS.critical} 
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </DataCard>
      </div>

      {dashboard?.critical_gaps && dashboard.critical_gaps.length > 0 && (
        <DataCard
          title="Priority Gaps"
          subtitle="Issues requiring immediate attention"
          icon={Target}
        >
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {dashboard.critical_gaps
              .sort((a, b) => {
                const priority = { critical: 0, high: 1, medium: 2, low: 3 };
                return (priority[a.priority.toLowerCase() as keyof typeof priority] || 4) - 
                       (priority[b.priority.toLowerCase() as keyof typeof priority] || 4);
              })
              .map((gap, index) => (
              <div
                key={index}
                className={`flex items-start gap-4 rounded-lg border p-4 transition-all ${
                  gap.priority === 'critical'
                    ? 'border-red-500/30 bg-red-500/10 hover:border-red-500/50'
                    : gap.priority === 'high'
                    ? 'border-amber-500/30 bg-amber-500/10 hover:border-amber-500/50'
                    : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                }`}
              >
                <div className={`rounded-lg p-2 ${
                  gap.priority === 'critical' ? 'bg-red-500/20' :
                  gap.priority === 'high' ? 'bg-amber-500/20' : 'bg-slate-700'
                }`}>
                  <AlertTriangle className={`h-5 w-5 ${
                    gap.priority === 'critical' ? 'text-red-400' :
                    gap.priority === 'high' ? 'text-amber-400' : 'text-slate-400'
                  }`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <SeverityBadge severity={gap.priority.toLowerCase() as any} size="sm" />
                    <span className="text-xs text-slate-500 capitalize">
                      {gap.type.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <p className="text-white">{gap.description}</p>
                  {gap.details && (
                    <p className="mt-1 text-sm text-slate-400">
                      {gap.details.controls_without_evidence !== undefined && (
                        <span>{gap.details.controls_without_evidence} of {gap.details.total_controls} controls without evidence</span>
                      )}
                      {gap.details.evidence_type && (
                        <span>Missing: {gap.details.evidence_type}</span>
                      )}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {gap.framework_id && (
                    <button
                      onClick={() => {
                        const fw = dashboard?.coverage_by_framework?.find(f => f.framework_id === gap.framework_id);
                        handleFrameworkClick(gap.framework_id!, fw?.framework_type);
                      }}
                      className="btn-ghost btn-sm"
                    >
                      View
                    </button>
                  )}
                  <Link
                    href={gap.framework_id ? `/evidence?framework=${gap.framework_id}` : '/evidence'}
                    className="btn-primary btn-sm flex items-center gap-1"
                  >
                    <Plus className="h-3 w-3" />
                    Fix Gap
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </DataCard>
      )}

      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">Framework Coverage</h2>
            <p className="card-description">Evidence coverage by compliance framework</p>
          </div>
        </div>
        
        {!dashboard?.coverage_by_framework?.length ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <BarChart3 className="mb-4 h-12 w-12 text-slate-600" />
            <h3 className="text-lg font-medium text-white">No framework data available</h3>
            <p className="mt-1 text-slate-400">Add frameworks and controls to see coverage</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-400">Framework</th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase text-slate-400">Total Controls</th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase text-slate-400">With Evidence</th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase text-slate-400">Without Evidence</th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase text-slate-400">Coverage</th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase text-slate-400">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {dashboard.coverage_by_framework.map((fw) => (
                  <tr
                    key={`${fw.framework_type || 'legacy'}-${fw.framework_id}`}
                    className="hover:bg-slate-700/50 cursor-pointer transition-colors"
                    onClick={() => handleFrameworkClick(fw.framework_id, fw.framework_type)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-700">
                          <Shield className="h-4 w-4 text-slate-400" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-white">{fw.framework_code}</p>
                            {fw.framework_type === 'uploaded' ? (
                              <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-cyan-500/20 text-cyan-400">uploaded</span>
                            ) : (
                              <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/20 text-amber-400">legacy</span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 truncate max-w-xs">{fw.framework_name}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center text-white">{fw.total_controls}</td>
                    <td className="px-4 py-3 text-center text-green-400">{fw.controls_with_evidence}</td>
                    <td className="px-4 py-3 text-center text-red-400">{fw.controls_without_evidence}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-2">
                        <ProgressRing
                          percentage={fw.coverage_percentage}
                          size={40}
                          strokeWidth={4}
                          color={fw.coverage_percentage >= 80 ? 'success' : fw.coverage_percentage >= 50 ? 'warning' : 'danger'}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button className="btn-ghost btn-sm inline-flex items-center gap-1">
                        Drill Down
                        <ArrowRight className="h-3 w-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="border-b border-slate-700">
          <div className="flex flex-wrap items-center gap-1 px-4">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'border-primary-500 text-primary-400'
                    : 'border-transparent text-slate-400 hover:text-white'
                }`}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
                {tab.id === 'unmapped' && unmappedControls?.total ? (
                  <span className="ml-1 rounded-full bg-orange-500/20 px-2 py-0.5 text-xs text-orange-400">
                    {unmappedControls.total}
                  </span>
                ) : null}
                {tab.id === 'no-evidence' && controlsWithoutEvidence?.total ? (
                  <span className="ml-1 rounded-full bg-red-500/20 px-2 py-0.5 text-xs text-red-400">
                    {controlsWithoutEvidence.total}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        <div className="p-4">
          <div className="mb-4 flex items-center gap-3">
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <select
                value={selectedFrameworkId ? `${selectedFrameworkType || 'legacy'}:${selectedFrameworkId}` : ''}
                onChange={(e) => {
                  if (!e.target.value) {
                    setSelectedFrameworkId(null);
                    setSelectedFrameworkType(null);
                  } else {
                    const [type, id] = e.target.value.split(':');
                    setSelectedFrameworkId(Number(id));
                    setSelectedFrameworkType(type);
                  }
                }}
                className="appearance-none rounded-lg border border-slate-600 bg-slate-800 py-2 pl-10 pr-10 text-white focus:border-primary-500 focus:outline-none"
              >
                <option value="">All Frameworks</option>
                {dashboard?.coverage_by_framework?.filter(fw => fw.framework_type === 'uploaded').length ? (
                  <optgroup label="Uploaded Frameworks">
                    {dashboard.coverage_by_framework.filter(fw => fw.framework_type === 'uploaded').map(fw => (
                      <option key={`uploaded-${fw.framework_id}`} value={`uploaded:${fw.framework_id}`}>
                        {fw.framework_code} - {fw.framework_name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {dashboard?.coverage_by_framework?.filter(fw => fw.framework_type !== 'uploaded').length ? (
                  <optgroup label="Legacy Frameworks">
                    {dashboard.coverage_by_framework.filter(fw => fw.framework_type !== 'uploaded').map(fw => (
                      <option key={`legacy-${fw.framework_id}`} value={`legacy:${fw.framework_id}`}>
                        {fw.framework_code} - {fw.framework_name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
          </div>

          {activeTab === 'unmapped' && (
            <div>
              {unmappedLoading ? (
                <div className="flex h-48 items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
                </div>
              ) : !unmappedControls?.controls.length ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <CheckCircle className="mb-4 h-12 w-12 text-green-400" />
                  <h3 className="text-lg font-medium text-white">All Controls Mapped!</h3>
                  <p className="mt-1 text-slate-400">All controls have been mapped to control groups</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-700">
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-400">Control Code</th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-400">Name</th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-400">Framework</th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-400">Type</th>
                        <th className="px-4 py-3 text-right text-xs font-medium uppercase text-slate-400">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700">
                      {unmappedControls.controls.map((control) => (
                        <tr key={`${control.control_type}-${control.id}`} className="hover:bg-slate-700/50">
                          <td className="px-4 py-3">
                            <span className="rounded bg-slate-700 px-2 py-1 text-sm font-mono text-white">
                              {control.code}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-white truncate max-w-xs">{control.name}</p>
                          </td>
                          <td className="px-4 py-3">
                            {control.framework ? (
                              <span className="rounded bg-primary-500/20 px-2 py-0.5 text-xs text-primary-400">
                                {control.framework.short_code}
                              </span>
                            ) : (
                              <span className="text-slate-500">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs capitalize ${
                              control.control_type === 'normalized' ? 'text-cyan-400' : 'text-purple-400'
                            }`}>
                              {control.control_type}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Link
                              href={`/control-library?map=${control.id}`}
                              className="btn-primary btn-sm inline-flex items-center gap-1"
                            >
                              <Plus className="h-3 w-3" />
                              Map Control
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {unmappedControls.total > 100 && (
                    <div className="mt-4 text-center text-sm text-slate-400">
                      Showing 100 of {unmappedControls.total} unmapped controls
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'no-evidence' && (
            <div>
              {noEvidenceLoading ? (
                <div className="flex h-48 items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
                </div>
              ) : !controlsWithoutEvidence?.controls.length ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <CheckCircle className="mb-4 h-12 w-12 text-green-400" />
                  <h3 className="text-lg font-medium text-white">All Controls Have Evidence!</h3>
                  <p className="mt-1 text-slate-400">All controls have at least one piece of evidence</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-700">
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-400">Control Code</th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-400">Name</th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-400">Framework</th>
                        <th className="px-4 py-3 text-center text-xs font-medium uppercase text-slate-400">Evidence</th>
                        <th className="px-4 py-3 text-right text-xs font-medium uppercase text-slate-400">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700">
                      {controlsWithoutEvidence.controls.map((control) => (
                        <tr key={`${control.control_type}-${control.id}`} className="hover:bg-slate-700/50">
                          <td className="px-4 py-3">
                            <span className="rounded bg-slate-700 px-2 py-1 text-sm font-mono text-white">
                              {control.code}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-white truncate max-w-xs">{control.name}</p>
                          </td>
                          <td className="px-4 py-3">
                            {control.framework ? (
                              <span className="rounded bg-primary-500/20 px-2 py-0.5 text-xs text-primary-400">
                                {control.framework.short_code}
                              </span>
                            ) : (
                              <span className="text-slate-500">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="rounded bg-red-500/20 px-2 py-0.5 text-xs text-red-400">
                              0
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Link
                              href={`/evidence?control=${control.id}`}
                              className="btn-primary btn-sm inline-flex items-center gap-1"
                            >
                              <Upload className="h-3 w-3" />
                              Add Evidence
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {controlsWithoutEvidence.total > 100 && (
                    <div className="mt-4 text-center text-sm text-slate-400">
                      Showing 100 of {controlsWithoutEvidence.total} controls without evidence
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'evidence-gaps' && (
            <div>
              {evidenceGapsLoading ? (
                <div className="flex h-48 items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
                </div>
              ) : !evidenceGaps?.controls_with_gaps?.length ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <CheckCircle className="mb-4 h-12 w-12 text-green-400" />
                  <h3 className="text-lg font-medium text-white">No Evidence Gaps!</h3>
                  <p className="mt-1 text-slate-400">All recommended evidence has been uploaded</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {evidenceGaps.controls_with_gaps.map((control) => (
                    <div
                      key={`${control.control_type}-${control.id}`}
                      className="rounded-lg border border-slate-700 bg-slate-800/50 p-4"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="rounded bg-slate-700 px-2 py-1 text-sm font-mono text-white">
                              {control.code}
                            </span>
                            {control.framework && (
                              <span className="rounded bg-primary-500/20 px-2 py-0.5 text-xs text-primary-400">
                                {control.framework.short_code}
                              </span>
                            )}
                          </div>
                          <p className="text-white">{control.name}</p>
                        </div>
                        <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-400">
                          {control.missing_count} missing
                        </span>
                      </div>
                      <div className="space-y-2">
                        {control.missing_evidence_types.map((missing, idx) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between rounded bg-slate-700/50 px-3 py-2"
                          >
                            <div className="flex items-center gap-3">
                              <AlertCircle className="h-4 w-4 text-amber-400" />
                              <div>
                                <p className="text-sm text-white">{missing.evidence_type}</p>
                                {missing.description && (
                                  <p className="text-xs text-slate-400">{missing.description}</p>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <SeverityBadge severity={missing.priority.toLowerCase() as any} size="sm" />
                              <Link
                                href={`/evidence?control=${control.id}&type=${missing.evidence_type}`}
                                className="btn-primary btn-sm inline-flex items-center gap-1"
                              >
                                <Upload className="h-3 w-3" />
                                Upload
                              </Link>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {evidenceGaps.total > 100 && (
                    <div className="mt-4 text-center text-sm text-slate-400">
                      Showing 100 of {evidenceGaps.total} controls with evidence gaps
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {showFrameworkDrillDown && selectedFrameworkId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="relative max-h-[90vh] w-full max-w-4xl overflow-auto rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <button
              onClick={() => {
                setShowFrameworkDrillDown(false);
                setSelectedFrameworkId(null);
                setSelectedFrameworkType(null);
              }}
              className="absolute right-4 top-4 rounded-lg p-2 text-slate-400 hover:bg-slate-700 hover:text-white"
            >
              <XCircle className="h-5 w-5" />
            </button>

            {frameworkGapsLoading ? (
              <div className="flex h-64 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
              </div>
            ) : frameworkGaps ? (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-white">
                    {frameworkGaps.framework_code} - {frameworkGaps.framework_name}
                  </h2>
                  <p className="text-slate-400">Framework gap analysis drill-down</p>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                  <StatCard
                    title="Total Controls"
                    value={frameworkGaps.total_controls}
                    icon={Shield}
                    variant="info"
                  />
                  <StatCard
                    title="Unmapped"
                    value={frameworkGaps.summary.unmapped_controls_count}
                    icon={Layers}
                    variant="warning"
                  />
                  <StatCard
                    title="No Evidence"
                    value={frameworkGaps.summary.no_evidence_count}
                    icon={FileWarning}
                    variant="danger"
                  />
                  <StatCard
                    title="Low Coverage"
                    value={frameworkGaps.summary.low_coverage_count}
                    icon={AlertTriangle}
                    variant="warning"
                  />
                </div>

                <div className="flex items-center justify-center">
                  <ProgressRing
                    percentage={Math.round(((frameworkGaps.total_controls - frameworkGaps.summary.no_evidence_count) / frameworkGaps.total_controls) * 100)}
                    size={120}
                    strokeWidth={10}
                    color={((frameworkGaps.total_controls - frameworkGaps.summary.no_evidence_count) / frameworkGaps.total_controls) * 100 >= 67 ? 'success' : 'warning'}
                    label="Coverage"
                  />
                </div>

                {frameworkGaps.unmapped_controls.length > 0 && (
                  <div>
                    <h3 className="mb-3 font-medium text-white">Unmapped Controls ({frameworkGaps.summary.unmapped_controls_count})</h3>
                    <div className="max-h-40 overflow-y-auto space-y-2">
                      {frameworkGaps.unmapped_controls.map((ctrl) => (
                        <div key={ctrl.id} className="flex items-center justify-between rounded bg-slate-800 px-3 py-2">
                          <span className="text-sm text-white">{ctrl.code} - {ctrl.name}</span>
                          <Link
                            href={`/control-library?map=${ctrl.id}`}
                            className="btn-ghost btn-sm text-primary-400"
                          >
                            Map
                          </Link>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {frameworkGaps.no_evidence_controls.length > 0 && (
                  <div>
                    <h3 className="mb-3 font-medium text-white">Controls Without Evidence ({frameworkGaps.summary.no_evidence_count})</h3>
                    <div className="max-h-40 overflow-y-auto space-y-2">
                      {frameworkGaps.no_evidence_controls.map((ctrl) => (
                        <div key={ctrl.id} className="flex items-center justify-between rounded bg-slate-800 px-3 py-2">
                          <span className="text-sm text-white">{ctrl.code} - {ctrl.name}</span>
                          <Link
                            href={`/evidence?control=${ctrl.id}`}
                            className="btn-ghost btn-sm text-primary-400"
                          >
                            Add Evidence
                          </Link>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-64 flex-col items-center justify-center text-center">
                <AlertCircle className="mb-4 h-12 w-12 text-slate-600" />
                <p className="text-slate-400">Unable to load framework gaps</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
