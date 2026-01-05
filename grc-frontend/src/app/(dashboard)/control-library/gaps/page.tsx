'use client';

import { useState } from 'react';
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
  PieChart,
  Layers,
  FileText,
  ExternalLink,
} from 'lucide-react';
import Link from 'next/link';

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

export default function GapAnalysisDashboardPage() {
  const [activeTab, setActiveTab] = useState('unmapped');
  const [selectedFrameworkId, setSelectedFrameworkId] = useState<number | null>(null);
  const [showFrameworkDrillDown, setShowFrameworkDrillDown] = useState(false);
  const [exportFormat, setExportFormat] = useState<'json' | 'csv'>('json');
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
    queryKey: ['framework-gaps', selectedFrameworkId],
    queryFn: async () => {
      if (!selectedFrameworkId) return null;
      const response = await apiClient.get(`/control-library/gap-analysis/framework-gaps/${selectedFrameworkId}`);
      return response.data as FrameworkGapsResponse;
    },
    enabled: !!selectedFrameworkId && showFrameworkDrillDown,
  });

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

  const handleFrameworkClick = (frameworkId: number) => {
    setSelectedFrameworkId(frameworkId);
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

  const getPriorityBadge = (priority: string) => {
    switch (priority.toLowerCase()) {
      case 'critical':
        return 'badge-danger';
      case 'high':
        return 'badge-warning';
      case 'medium':
        return 'badge-neutral';
      default:
        return 'badge-success';
    }
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

  const stats = [
    {
      name: 'Total Controls',
      value: dashboard?.total_controls || 0,
      icon: Shield,
      iconColor: 'text-primary-400',
      bgColor: 'from-primary-500/20 to-primary-600/10',
    },
    {
      name: 'Mapped Controls',
      value: dashboard?.mapped_controls || 0,
      percentage: dashboard?.mapping_percentage,
      icon: CheckCircle,
      iconColor: 'text-green-400',
      bgColor: 'from-green-500/20 to-green-600/10',
    },
    {
      name: 'Unmapped Controls',
      value: dashboard?.unmapped_controls || 0,
      percentage: dashboard?.total_controls ? Math.round((dashboard.unmapped_controls / dashboard.total_controls) * 100) : 0,
      icon: XCircle,
      iconColor: 'text-orange-400',
      bgColor: 'from-orange-500/20 to-orange-600/10',
    },
    {
      name: 'With Evidence',
      value: dashboard?.controls_with_evidence || 0,
      percentage: dashboard?.evidence_coverage_percentage,
      icon: FileText,
      iconColor: 'text-cyan-400',
      bgColor: 'from-cyan-500/20 to-cyan-600/10',
    },
    {
      name: 'Critical Gaps',
      value: dashboard?.critical_gaps?.filter(g => g.priority === 'critical').length || 0,
      icon: AlertTriangle,
      iconColor: 'text-red-400',
      bgColor: 'from-red-500/20 to-red-600/10',
    },
  ];

  return (
    <div className="space-y-8">
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

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-5">
        {stats.map((stat) => (
          <div
            key={stat.name}
            className="stat-card"
          >
            <div className="flex items-start justify-between mb-4">
              <div className={`rounded-xl bg-gradient-to-br ${stat.bgColor} p-3`}>
                <stat.icon className={`h-6 w-6 ${stat.iconColor}`} />
              </div>
              {stat.percentage !== undefined && (
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  stat.percentage >= 70 ? 'bg-green-500/20 text-green-400' :
                  stat.percentage >= 40 ? 'bg-yellow-500/20 text-yellow-400' :
                  'bg-red-500/20 text-red-400'
                }`}>
                  {stat.percentage}%
                </span>
              )}
            </div>
            <p className="stat-value">{stat.value}</p>
            <p className="stat-label">{stat.name}</p>
          </div>
        ))}
      </div>

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
                    key={fw.framework_id}
                    className="hover:bg-slate-700/50 cursor-pointer transition-colors"
                    onClick={() => handleFrameworkClick(fw.framework_id)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-700">
                          <Shield className="h-4 w-4 text-slate-400" />
                        </div>
                        <div>
                          <p className="font-medium text-white">{fw.framework_code}</p>
                          <p className="text-xs text-slate-400 truncate max-w-xs">{fw.framework_name}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center text-white">{fw.total_controls}</td>
                    <td className="px-4 py-3 text-center text-green-400">{fw.controls_with_evidence}</td>
                    <td className="px-4 py-3 text-center text-red-400">{fw.controls_without_evidence}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-2">
                        <div className="h-2 w-20 overflow-hidden rounded-full bg-slate-700">
                          <div
                            className={`h-full transition-all ${getCoverageColor(fw.coverage_percentage)}`}
                            style={{ width: `${fw.coverage_percentage}%` }}
                          />
                        </div>
                        <span className={`text-sm font-medium ${getCoverageTextColor(fw.coverage_percentage)}`}>
                          {fw.coverage_percentage}%
                        </span>
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

      {dashboard?.critical_gaps && dashboard.critical_gaps.length > 0 && (
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Critical Gaps</h2>
              <p className="card-description">Priority issues requiring immediate attention</p>
            </div>
          </div>
          <div className="space-y-3">
            {dashboard.critical_gaps.map((gap, index) => (
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
                    <span className={getPriorityBadge(gap.priority)}>{gap.priority}</span>
                    <span className="text-xs text-slate-500">
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
                {gap.framework_id && (
                  <button
                    onClick={() => handleFrameworkClick(gap.framework_id!)}
                    className="btn-ghost btn-sm"
                  >
                    View Details
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

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
              </button>
            ))}
          </div>
        </div>

        <div className="p-4">
          <div className="mb-4 flex items-center gap-3">
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <select
                value={selectedFrameworkId || ''}
                onChange={(e) => setSelectedFrameworkId(e.target.value ? Number(e.target.value) : null)}
                className="appearance-none rounded-lg border border-slate-600 bg-slate-800 py-2 pl-10 pr-10 text-white focus:border-primary-500 focus:outline-none"
              >
                <option value="">All Frameworks</option>
                {dashboard?.coverage_by_framework?.map(fw => (
                  <option key={fw.framework_id} value={fw.framework_id}>
                    {fw.framework_code} - {fw.framework_name}
                  </option>
                ))}
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
                              className="btn-ghost btn-sm inline-flex items-center gap-1"
                            >
                              <Plus className="h-3 w-3" />
                              Add to Group
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
                              className="btn-ghost btn-sm inline-flex items-center gap-1"
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
                              <span className={getPriorityBadge(missing.priority)}>
                                {missing.priority}
                              </span>
                              <Link
                                href={`/evidence?control=${control.id}&type=${missing.evidence_type}`}
                                className="btn-ghost btn-sm inline-flex items-center gap-1"
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
                  <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4 text-center">
                    <p className="text-2xl font-bold text-white">{frameworkGaps.total_controls}</p>
                    <p className="text-sm text-slate-400">Total Controls</p>
                  </div>
                  <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4 text-center">
                    <p className="text-2xl font-bold text-orange-400">{frameworkGaps.summary.unmapped_controls_count}</p>
                    <p className="text-sm text-slate-400">Unmapped</p>
                  </div>
                  <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4 text-center">
                    <p className="text-2xl font-bold text-red-400">{frameworkGaps.summary.no_evidence_count}</p>
                    <p className="text-sm text-slate-400">No Evidence</p>
                  </div>
                  <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4 text-center">
                    <p className="text-2xl font-bold text-amber-400">{frameworkGaps.summary.low_coverage_count}</p>
                    <p className="text-sm text-slate-400">Low Coverage</p>
                  </div>
                </div>

                <div className="flex items-center justify-center">
                  <div className="relative h-48 w-48">
                    <svg className="h-full w-full" viewBox="0 0 100 100">
                      <circle
                        cx="50"
                        cy="50"
                        r="40"
                        fill="none"
                        stroke="#334155"
                        strokeWidth="20"
                      />
                      <circle
                        cx="50"
                        cy="50"
                        r="40"
                        fill="none"
                        stroke="#22c55e"
                        strokeWidth="20"
                        strokeDasharray={`${((frameworkGaps.total_controls - frameworkGaps.summary.no_evidence_count) / frameworkGaps.total_controls) * 251.2} 251.2`}
                        strokeDashoffset="0"
                        transform="rotate(-90 50 50)"
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <p className="text-2xl font-bold text-white">
                        {Math.round(((frameworkGaps.total_controls - frameworkGaps.summary.no_evidence_count) / frameworkGaps.total_controls) * 100)}%
                      </p>
                      <p className="text-xs text-slate-400">Coverage</p>
                    </div>
                  </div>
                </div>

                {frameworkGaps.unmapped_controls.length > 0 && (
                  <div>
                    <h3 className="mb-3 font-medium text-white">Unmapped Controls ({frameworkGaps.summary.unmapped_controls_count})</h3>
                    <div className="max-h-40 overflow-y-auto space-y-2">
                      {frameworkGaps.unmapped_controls.map((ctrl) => (
                        <div key={ctrl.id} className="flex items-center justify-between rounded bg-slate-800 px-3 py-2">
                          <span className="text-sm text-white">{ctrl.code} - {ctrl.name}</span>
                          <span className="text-xs text-orange-400">Unmapped</span>
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
                          <span className="text-xs text-red-400">No Evidence</span>
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
