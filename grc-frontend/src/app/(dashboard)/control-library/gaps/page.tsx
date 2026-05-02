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

function dedupeFrameworkCoverage<T extends { framework_id: number; framework_name: string; framework_code: string; total_controls: number }>(frameworks: T[]) {
  const map = new Map<string, T>();

  frameworks.forEach((framework) => {
    const key = `${(framework.framework_code || '').trim().toLowerCase()}::${(framework.framework_name || '').trim().toLowerCase()}`;
    const existing = map.get(key);
    if (!existing || framework.total_controls > existing.total_controls) {
      map.set(key, framework);
    }
  });

  return Array.from(map.values()).sort((a, b) =>
    `${a.framework_name || a.framework_code}`.localeCompare(`${b.framework_name || b.framework_code}`)
  );
}

function shortenFrameworkLabel(value?: string, max = 22) {
  if (!value) return 'Unknown';
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function frameworkSelectionKey(frameworkId: number, frameworkType?: string | null) {
  return `${frameworkType || 'legacy'}:${frameworkId}`;
}

export default function GapAnalysisDashboardPage() {
  const [activeTab, setActiveTab] = useState('no-evidence');
  const [selectedFrameworkId, setSelectedFrameworkId] = useState<number | null>(null);
  const [selectedFrameworkType, setSelectedFrameworkType] = useState<string | null>(null);
  const [coverageFrameworkSelection, setCoverageFrameworkSelection] = useState<string>('all');
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

  const uniqueFrameworkCoverage = useMemo(() => {
    return dedupeFrameworkCoverage(dashboard?.coverage_by_framework || []);
  }, [dashboard]);

  const mappingHealthData = useMemo(() => {
    return [
      { name: 'Mapped', value: dashboard?.mapped_controls || 0, color: COLORS.green },
      { name: 'Unmapped', value: dashboard?.unmapped_controls || 0, color: COLORS.critical },
    ].filter((entry) => entry.value > 0);
  }, [dashboard]);

  const evidenceHealthData = useMemo(() => {
    return [
      { name: 'With Evidence', value: dashboard?.controls_with_evidence || 0, color: COLORS.green },
      { name: 'Without Evidence', value: dashboard?.controls_without_evidence || 0, color: COLORS.high },
    ].filter((entry) => entry.value > 0);
  }, [dashboard]);

  const frameworkChartData = useMemo(() => {
    if (!uniqueFrameworkCoverage.length) return [];
    return uniqueFrameworkCoverage.map(fw => ({
      name: fw.framework_name || fw.framework_code,
      frameworkCode: fw.framework_code,
      frameworkKey: frameworkSelectionKey(fw.framework_id, fw.framework_type),
      fullName: fw.framework_name,
      covered: fw.controls_with_evidence,
      uncovered: fw.controls_without_evidence,
      coverage: fw.coverage_percentage,
    }));
  }, [uniqueFrameworkCoverage]);

  const selectedCoverageFramework = useMemo(() => {
    if (coverageFrameworkSelection === 'all') return null;
    return uniqueFrameworkCoverage.find(
      (framework) => frameworkSelectionKey(framework.framework_id, framework.framework_type) === coverageFrameworkSelection
    ) || null;
  }, [coverageFrameworkSelection, uniqueFrameworkCoverage]);

  const selectedFrameworkEvidenceSplit = useMemo(() => {
    if (!selectedCoverageFramework) return [];
    return [
      { name: 'With Evidence', value: selectedCoverageFramework.controls_with_evidence, color: COLORS.green },
      { name: 'Without Evidence', value: selectedCoverageFramework.controls_without_evidence, color: COLORS.critical },
    ];
  }, [selectedCoverageFramework]);

  const topFrameworkGapsData = useMemo(() => {
    return [...uniqueFrameworkCoverage]
      .sort((a, b) => b.controls_without_evidence - a.controls_without_evidence)
      .slice(0, 12)
      .map((framework) => ({
        key: frameworkSelectionKey(framework.framework_id, framework.framework_type),
        name: framework.framework_code || framework.framework_name,
        fullName: framework.framework_name || framework.framework_code,
        uncovered: framework.controls_without_evidence,
        total: framework.total_controls,
      }));
  }, [uniqueFrameworkCoverage]);

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

  if (dashboardLoading) {
    return (
      <div className="assets-light min-h-full space-y-4 bg-slate-50 p-4 md:p-6">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="skeleton h-8 w-64 mb-2" />
          <div className="skeleton h-5 w-96" />
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-white p-3.5">
              <div className="skeleton h-12 w-12 rounded-xl mb-4" />
              <div className="skeleton h-8 w-20 mb-2" />
              <div className="skeleton h-4 w-32" />
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
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
    <div className="assets-light min-h-full space-y-4 bg-slate-50 p-4 md:p-6">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-900 sm:text-xl">Gap Analysis Dashboard</h1>
            <p className="text-sm text-slate-600">Identify and address control mapping and evidence gaps</p>
          </div>
          <div className="relative">
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
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
              <div className="absolute right-0 top-full z-10 mt-2 w-40 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                <button
                  onClick={() => exportMutation.mutate('json')}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                >
                  <FileText className="h-4 w-4" />
                  Export as JSON
                </button>
                <button
                  onClick={() => exportMutation.mutate('csv')}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                >
                  <FileText className="h-4 w-4" />
                  Export as CSV
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
        <div className="flex items-center justify-center rounded-xl border border-slate-200 bg-white p-4">
          <ProgressRing
            percentage={dashboard?.evidence_coverage_percentage || 0}
            size={80}
            color={dashboard && dashboard.evidence_coverage_percentage >= 67 ? 'success' : dashboard && dashboard.evidence_coverage_percentage >= 34 ? 'warning' : 'danger'}
            label="Coverage"
          />
        </div>
      </div>

      {false && (
      <div className="grid grid-cols-1 gap-4">
        <DataCard
          title="Framework Coverage"
          subtitle="Select a framework to inspect coverage"
          icon={BarChart3}
          empty={frameworkChartData.length === 0}
          emptyMessage="No framework data"
        >
          <div className="mb-3">
            <select
              value={coverageFrameworkSelection}
              onChange={(event) => setCoverageFrameworkSelection(event.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
            >
              <option value="all">All Frameworks</option>
              {uniqueFrameworkCoverage.map((framework) => (
                <option
                  key={frameworkSelectionKey(framework.framework_id, framework.framework_type)}
                  value={frameworkSelectionKey(framework.framework_id, framework.framework_type)}
                >
                  {framework.framework_code} - {framework.framework_name}
                </option>
              ))}
            </select>
          </div>

          {selectedCoverageFramework ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">With Evidence</p>
                  <p className="mt-1 text-lg font-semibold text-green-600">{selectedCoverageFramework!.controls_with_evidence}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Without Evidence</p>
                  <p className="mt-1 text-lg font-semibold text-red-600">{selectedCoverageFramework!.controls_without_evidence}</p>
                </div>
              </div>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={selectedFrameworkEvidenceSplit} margin={{ top: 6, right: 6, left: 0, bottom: 6 }}>
                    <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: '8px',
                        color: '#0f172a',
                      }}
                    />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                      {selectedFrameworkEvidenceSplit.map((entry, index) => (
                        <Cell key={`split-cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs text-slate-500">
                  Coverage: <span className="font-semibold text-slate-900">{selectedCoverageFramework!.coverage_percentage}%</span> ({selectedCoverageFramework!.framework_code})
                </p>
              </div>
            </div>
          ) : (
            <div
              className="overflow-y-auto"
              style={{ height: Math.min(420, Math.max(220, frameworkChartData.length * 22 + 16)) }}
            >
              <ResponsiveContainer width="100%" height={Math.max(220, frameworkChartData.length * 22)}>
                <BarChart data={frameworkChartData} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }}>
                  <XAxis type="number" domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 11 }} />
                  <YAxis dataKey="name" type="category" tick={{ fill: '#334155', fontSize: 11 }} width={160} interval={0} tickFormatter={(value) => shortenFrameworkLabel(String(value), 22)} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '8px',
                      color: '#0f172a',
                    }}
                    formatter={(value) => {
                      const numericValue = typeof value === 'number' ? value : Number(value ?? 0);
                      return [`${numericValue}%`, 'Coverage'];
                    }}
                  />
                  <Bar dataKey="coverage" radius={[0, 4, 4, 0]}>
                    {frameworkChartData.map((entry, index) => (
                      <Cell
                        key={`coverage-cell-${index}`}
                        fill={entry.coverage >= 80 ? COLORS.green : entry.coverage >= 50 ? COLORS.medium : COLORS.critical}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </DataCard>
      </div>
      )}

      {false && (
      <DataCard
        title="Top Framework Gaps"
        subtitle={`Top ${topFrameworkGapsData.length} frameworks with highest controls missing evidence`}
        icon={AlertCircle}
        empty={topFrameworkGapsData.length === 0}
        emptyMessage="No framework gaps detected"
      >
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={topFrameworkGapsData} margin={{ top: 8, right: 12, left: 8, bottom: 70 }}>
              <XAxis
                dataKey="name"
                tick={{ fill: '#475569', fontSize: 11 }}
                interval={0}
                angle={-35}
                textAnchor="end"
                height={70}
              />
              <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  color: '#0f172a',
                }}
                formatter={(value, _name, payload) => {
                  const uncovered = typeof value === 'number' ? value : Number(value ?? 0);
                  return [`${uncovered} missing evidence`, payload?.payload?.fullName || 'Framework'];
                }}
              />
              <Bar dataKey="uncovered" radius={[6, 6, 0, 0]}>
                {topFrameworkGapsData.map((entry, index) => {
                  const max = topFrameworkGapsData[0]?.uncovered || 1;
                  const ratio = entry.uncovered / max;
                  // Severity-graded coloring: top gaps are red, mid amber, lower blue.
                  const fill = ratio >= 0.66 ? COLORS.critical : ratio >= 0.33 ? COLORS.high : COLORS.low;
                  return <Cell key={`top-gap-${index}`} fill={fill} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </DataCard>
      )}

      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Framework Coverage</h2>
            <p className="text-xs text-slate-500">Evidence coverage by compliance framework</p>
          </div>
        </div>
        
        {!dashboard?.coverage_by_framework?.length ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <BarChart3 className="mb-4 h-12 w-12 text-slate-400" />
            <h3 className="text-lg font-medium text-slate-900">No framework data available</h3>
            <p className="mt-1 text-slate-600">Add frameworks and controls to see coverage</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">Framework</th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase text-slate-500">Total Controls</th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase text-slate-500">With Evidence</th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase text-slate-500">Without Evidence</th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase text-slate-500">Coverage</th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase text-slate-500">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {uniqueFrameworkCoverage.map((fw) => (
                  <tr
                    key={`${fw.framework_type || 'legacy'}-${fw.framework_id}`}
                    className="cursor-pointer transition-colors hover:bg-slate-50"
                    onClick={() => handleFrameworkClick(fw.framework_id, fw.framework_type)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Shield className="h-4 w-4 text-slate-600 flex-shrink-0" />
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-slate-900">{fw.framework_code}</p>
                            {fw.framework_type === 'uploaded' ? (
                              <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-cyan-100 text-cyan-700">uploaded</span>
                            ) : (
                              <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/20 text-amber-400">legacy</span>
                            )}
                          </div>
                          <p className="max-w-xs truncate text-xs text-slate-600">{fw.framework_name}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center text-slate-900">{fw.total_controls}</td>
                    <td className="px-4 py-3 text-center text-green-600">{fw.controls_with_evidence}</td>
                    <td className="px-4 py-3 text-center text-red-600">{fw.controls_without_evidence}</td>
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

      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200">
          <div className="flex flex-wrap items-center gap-1 px-4">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'border-primary-500 text-blue-600'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
                {tab.id === 'unmapped' && unmappedControls?.total ? (
                  <span className="ml-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-700">
                    {unmappedControls.total}
                  </span>
                ) : null}
                {tab.id === 'no-evidence' && controlsWithoutEvidence?.total ? (
                  <span className="ml-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
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
              <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
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
                className="appearance-none rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-10 text-slate-900 focus:border-blue-500 focus:outline-none"
              >
                <option value="">All Frameworks</option>
                {uniqueFrameworkCoverage.filter(fw => fw.framework_type === 'uploaded').length ? (
                  <optgroup label="Uploaded Frameworks">
                    {uniqueFrameworkCoverage.filter(fw => fw.framework_type === 'uploaded').map(fw => (
                      <option key={`uploaded-${fw.framework_id}`} value={`uploaded:${fw.framework_id}`}>
                        {fw.framework_code} - {fw.framework_name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {uniqueFrameworkCoverage.filter(fw => fw.framework_type !== 'uploaded').length ? (
                  <optgroup label="Legacy Frameworks">
                    {uniqueFrameworkCoverage.filter(fw => fw.framework_type !== 'uploaded').map(fw => (
                      <option key={`legacy-${fw.framework_id}`} value={`legacy:${fw.framework_id}`}>
                        {fw.framework_code} - {fw.framework_name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            </div>
          </div>

          {activeTab === 'unmapped' && (
            <div>
              {unmappedLoading ? (
                <div className="flex h-48 items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                </div>
              ) : !unmappedControls?.controls.length ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <CheckCircle className="mb-4 h-12 w-12 text-green-400" />
                  <h3 className="text-lg font-medium text-black">All Controls Mapped!</h3>
                  <p className="mt-1 text-gray-600">All controls have been mapped to control groups</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-600">Control Code</th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-600">Name</th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-600">Framework</th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-600">Type</th>
                        <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-600">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {unmappedControls.controls.map((control) => (
                        <tr key={`${control.control_type}-${control.id}`} className="hover:bg-gray-100">
                          <td className="px-4 py-3">
                            <span className="rounded bg-gray-100 px-2 py-1 text-sm font-mono text-black">
                              {control.code}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-black truncate max-w-xs">{control.name}</p>
                          </td>
                          <td className="px-4 py-3">
                            {control.framework ? (
                              <span className="rounded bg-primary-500/20 px-2 py-0.5 text-xs text-blue-600">
                                {control.framework.short_code}
                              </span>
                            ) : (
                              <span className="text-gray-500">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs capitalize ${
                              control.control_type === 'normalized' ? 'text-cyan-700' : 'text-purple-700'
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
                    <div className="mt-4 text-center text-sm text-gray-600">
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
                  <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                </div>
              ) : !controlsWithoutEvidence?.controls.length ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <CheckCircle className="mb-4 h-12 w-12 text-green-400" />
                  <h3 className="text-lg font-medium text-black">All Controls Have Evidence!</h3>
                  <p className="mt-1 text-gray-600">All controls have at least one piece of evidence</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-600">Control Code</th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-600">Name</th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-600">Framework</th>
                        <th className="px-4 py-3 text-center text-xs font-medium uppercase text-gray-600">Evidence</th>
                        <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-600">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {controlsWithoutEvidence.controls.map((control) => (
                        <tr key={`${control.control_type}-${control.id}`} className="hover:bg-gray-100">
                          <td className="px-4 py-3">
                            <span className="rounded bg-gray-100 px-2 py-1 text-sm font-mono text-black">
                              {control.code}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-black truncate max-w-xs">{control.name}</p>
                          </td>
                          <td className="px-4 py-3">
                            {control.framework ? (
                              <span className="rounded bg-primary-500/20 px-2 py-0.5 text-xs text-blue-600">
                                {control.framework.short_code}
                              </span>
                            ) : (
                              <span className="text-gray-500">-</span>
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
                    <div className="mt-4 text-center text-sm text-gray-600">
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
                  <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                </div>
              ) : !evidenceGaps?.controls_with_gaps?.length ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <CheckCircle className="mb-4 h-12 w-12 text-green-400" />
                  <h3 className="text-lg font-medium text-black">No Evidence Gaps!</h3>
                  <p className="mt-1 text-gray-600">All recommended evidence has been uploaded</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {evidenceGaps.controls_with_gaps.map((control) => (
                    <div
                      key={`${control.control_type}-${control.id}`}
                      className="rounded-lg border border-gray-200 bg-gray-50 p-4"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="rounded bg-gray-100 px-2 py-1 text-sm font-mono text-black">
                              {control.code}
                            </span>
                            {control.framework && (
                              <span className="rounded bg-primary-500/20 px-2 py-0.5 text-xs text-blue-600">
                                {control.framework.short_code}
                              </span>
                            )}
                          </div>
                          <p className="text-black">{control.name}</p>
                        </div>
                        <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-400">
                          {control.missing_count} missing
                        </span>
                      </div>
                      <div className="space-y-2">
                        {control.missing_evidence_types.map((missing, idx) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between rounded bg-gray-100 px-3 py-2"
                          >
                            <div className="flex items-center gap-3">
                              <AlertCircle className="h-4 w-4 text-amber-400" />
                              <div>
                                <p className="text-sm text-black">{missing.evidence_type}</p>
                                {missing.description && (
                                  <p className="text-xs text-gray-600">{missing.description}</p>
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
                    <div className="mt-4 text-center text-sm text-gray-600">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="relative max-h-[90vh] w-full max-w-4xl overflow-auto rounded-xl border border-gray-200 bg-white p-6 shadow-2xl">
            <button
              onClick={() => {
                setShowFrameworkDrillDown(false);
                setSelectedFrameworkId(null);
                setSelectedFrameworkType(null);
              }}
              className="absolute right-4 top-4 rounded-lg p-2 text-gray-600 hover:bg-gray-100 hover:text-black"
            >
              <XCircle className="h-5 w-5" />
            </button>

            {frameworkGapsLoading ? (
              <div className="flex h-64 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
              </div>
            ) : frameworkGaps ? (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-black">
                    {frameworkGaps.framework_code} - {frameworkGaps.framework_name}
                  </h2>
                  <p className="text-gray-600">Framework gap analysis drill-down</p>
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
                    <h3 className="mb-3 font-medium text-black">Unmapped Controls ({frameworkGaps.summary.unmapped_controls_count})</h3>
                    <div className="max-h-40 overflow-y-auto space-y-2">
                      {frameworkGaps.unmapped_controls.map((ctrl) => (
                        <div key={ctrl.id} className="flex items-center justify-between rounded bg-white px-3 py-2">
                          <span className="text-sm text-black">{ctrl.code} - {ctrl.name}</span>
                          <Link
                            href={`/control-library?map=${ctrl.id}`}
                            className="btn-ghost btn-sm text-blue-600"
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
                    <h3 className="mb-3 font-medium text-black">Controls Without Evidence ({frameworkGaps.summary.no_evidence_count})</h3>
                    <div className="max-h-40 overflow-y-auto space-y-2">
                      {frameworkGaps.no_evidence_controls.map((ctrl) => (
                        <div key={ctrl.id} className="flex items-center justify-between rounded bg-white px-3 py-2">
                          <span className="text-sm text-black">{ctrl.code} - {ctrl.name}</span>
                          <Link
                            href={`/evidence?control=${ctrl.id}`}
                            className="btn-ghost btn-sm text-blue-600"
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
                <AlertCircle className="mb-4 h-12 w-12 text-gray-400" />
                <p className="text-gray-600">Unable to load framework gaps</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
