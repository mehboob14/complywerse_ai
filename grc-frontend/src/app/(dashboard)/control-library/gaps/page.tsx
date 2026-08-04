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
  Upload,
  ChevronDown,
  BarChart3,
  Layers,
  FileText,
  TrendingDown,
  Target,
} from 'lucide-react';
import Link from 'next/link';
import { StatCard, ProgressRing, SeverityBadge, PageLoader } from '@/components/ui';

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

export default function GapAnalysisDashboardPage() {
  const [activeTab, setActiveTab] = useState('no-evidence');
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
    <div className="assets-light min-h-full space-y-5 bg-slate-50 p-4 md:p-6">
      <div className="relative overflow-hidden rounded-2xl bg-amber-600 p-6 text-white shadow-sm">
        <div className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -right-20 bottom-0 h-44 w-44 rounded-full bg-white/5" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25"><Target size={24} /></span>
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-amber-100">Control library · analytics</div>
              <h1 className="text-2xl font-bold leading-tight">Gap Analysis</h1>
              <p className="mt-1 max-w-2xl text-sm text-amber-50/90">Find controls without evidence and close coverage gaps across the unified library.</p>
            </div>
          </div>
          <div className="relative">
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="flex items-center gap-2 rounded-lg bg-white/15 px-3.5 py-2 text-sm font-medium text-white ring-1 ring-white/25 backdrop-blur transition-colors hover:bg-white/25 disabled:opacity-50"
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
                              <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-primary-50 text-primary-700">uploaded</span>
                            ) : (
                              <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-600">legacy</span>
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
                    ? 'border-primary-500 text-primary-700'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                <tab.icon className="h-4 w-4" strokeWidth={1.75} />
                {tab.label}
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


          {activeTab === 'no-evidence' && (
            <div>
              {noEvidenceLoading ? (
                <div className="flex h-48 items-center justify-center">
                  <PageLoader size="md" />
                </div>
              ) : !controlsWithoutEvidence?.controls.length ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <CheckCircle className="mb-4 h-12 w-12 text-green-400" />
                  <h3 className="text-lg font-medium text-slate-900">All Controls Have Evidence!</h3>
                  <p className="mt-1 text-slate-500">All controls have at least one piece of evidence</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">Control Code</th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">Name</th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">Framework</th>
                        <th className="px-4 py-3 text-center text-xs font-medium uppercase text-slate-500">Evidence</th>
                        <th className="px-4 py-3 text-right text-xs font-medium uppercase text-slate-500">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {controlsWithoutEvidence.controls.map((control) => (
                        <tr key={`${control.control_type}-${control.id}`} className="hover:bg-slate-100">
                          <td className="px-4 py-3">
                            <span className="rounded bg-slate-100 px-2 py-1 text-sm font-mono text-slate-900">
                              {control.code}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-slate-900 truncate max-w-xs">{control.name}</p>
                          </td>
                          <td className="px-4 py-3">
                            {control.framework ? (
                              <span className="rounded bg-primary-50 px-2 py-0.5 text-xs text-primary-700">
                                {control.framework.short_code}
                              </span>
                            ) : (
                              <span className="text-slate-400">-</span>
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
                    <div className="mt-4 text-center text-sm text-slate-500">
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
                  <PageLoader size="md" />
                </div>
              ) : !evidenceGaps?.controls_with_gaps?.length ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <CheckCircle className="mb-4 h-12 w-12 text-green-400" />
                  <h3 className="text-lg font-medium text-slate-900">No Evidence Gaps!</h3>
                  <p className="mt-1 text-slate-500">All recommended evidence has been uploaded</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {evidenceGaps.controls_with_gaps.map((control) => (
                    <div
                      key={`${control.control_type}-${control.id}`}
                      className="rounded-lg border border-slate-200 bg-slate-50 p-4"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="rounded bg-slate-100 px-2 py-1 text-sm font-mono text-slate-900">
                              {control.code}
                            </span>
                            {control.framework && (
                              <span className="rounded bg-primary-50 px-2 py-0.5 text-xs text-primary-700">
                                {control.framework.short_code}
                              </span>
                            )}
                          </div>
                          <p className="text-slate-900">{control.name}</p>
                        </div>
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                          {control.missing_count} missing
                        </span>
                      </div>
                      <div className="space-y-2">
                        {control.missing_evidence_types.map((missing, idx) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between rounded bg-slate-100 px-3 py-2"
                          >
                            <div className="flex items-center gap-3">
                              <AlertCircle className="h-4 w-4 text-amber-600" strokeWidth={1.75} />
                              <div>
                                <p className="text-sm text-slate-900">{missing.evidence_type}</p>
                                {missing.description && (
                                  <p className="text-xs text-slate-500">{missing.description}</p>
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
                    <div className="mt-4 text-center text-sm text-slate-500">
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
          <div className="relative max-h-[90vh] w-full max-w-4xl overflow-auto rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
            <button
              onClick={() => {
                setShowFrameworkDrillDown(false);
                setSelectedFrameworkId(null);
                setSelectedFrameworkType(null);
              }}
              className="absolute right-4 top-4 rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              <XCircle className="h-5 w-5" />
            </button>

            {frameworkGapsLoading ? (
              <div className="flex h-64 items-center justify-center">
                <PageLoader size="md" />
              </div>
            ) : frameworkGaps ? (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">
                    {frameworkGaps.framework_code} - {frameworkGaps.framework_name}
                  </h2>
                  <p className="text-slate-500">Framework gap analysis drill-down</p>
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
                    <h3 className="mb-3 font-medium text-slate-900">Unmapped Controls ({frameworkGaps.summary.unmapped_controls_count})</h3>
                    <div className="max-h-40 overflow-y-auto space-y-2">
                      {frameworkGaps.unmapped_controls.map((ctrl) => (
                        <div key={ctrl.id} className="flex items-center justify-between rounded bg-white px-3 py-2">
                          <span className="text-sm text-slate-900">{ctrl.code} - {ctrl.name}</span>
                          <Link
                            href={`/control-library?map=${ctrl.id}`}
                            className="btn-ghost btn-sm text-primary-700"
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
                    <h3 className="mb-3 font-medium text-slate-900">Controls Without Evidence ({frameworkGaps.summary.no_evidence_count})</h3>
                    <div className="max-h-40 overflow-y-auto space-y-2">
                      {frameworkGaps.no_evidence_controls.map((ctrl) => (
                        <div key={ctrl.id} className="flex items-center justify-between rounded bg-white px-3 py-2">
                          <span className="text-sm text-slate-900">{ctrl.code} - {ctrl.name}</span>
                          <Link
                            href={`/evidence?control=${ctrl.id}`}
                            className="btn-ghost btn-sm text-primary-700"
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
                <AlertCircle className="mb-4 h-12 w-12 text-slate-400" />
                <p className="text-slate-500">Unable to load framework gaps</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
