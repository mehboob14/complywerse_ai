'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import {
  GitCompare,
  Loader2,
  AlertCircle,
  Download,
  ChevronDown,
  X,
  Shield,
  Layers,
  Brain,
  ArrowRight,
  CheckCircle,
  XCircle,
  Sparkles,
  FileText,
  Grid3X3,
} from 'lucide-react';

interface FrameworkInfo {
  id: number;
  name: string;
  short_code: string;
  version?: string;
  regulator?: string;
  jurisdiction?: string;
  control_count: number;
  domain_count: number;
}

interface MatrixCell {
  shared_mappings: number;
  framework1_controls: number;
  framework2_controls: number;
}

interface MatrixRow {
  framework_id: number;
  framework_name: string;
  framework_code: string;
  mappings: Record<number, MatrixCell | null>;
}

interface ControlInfo {
  id: number;
  code: string;
  name: string;
  statement?: string;
  mapping_confidence?: number;
}

interface ComparisonGridItem {
  group_id: number;
  group_code: string;
  group_name: string;
  category: string;
  domain: string;
  framework_controls: Record<number, ControlInfo[]>;
}

interface SideBySideComparison {
  pair: {
    control1: { type: string; id: number };
    control2: { type: string; id: number };
  };
  control1: {
    id: number;
    type: string;
    code: string;
    name: string;
    statement?: string;
    objective?: string;
    framework_id?: number;
    framework_name?: string;
    framework_code?: string;
    control_text?: string;
  };
  control2: {
    id: number;
    type: string;
    code: string;
    name: string;
    statement?: string;
    objective?: string;
    framework_id?: number;
    framework_name?: string;
    framework_code?: string;
    control_text?: string;
  };
  comparison: {
    similarity_score: number;
    common_keywords: string[];
    differences: string[];
    control1_unique: string[];
    control2_unique: string[];
    control1_stricter: string[];
    control2_stricter: string[];
  };
  error?: string;
}

interface AIDifferenceAnalysis {
  control: {
    id: number;
    type: string;
    code: string;
    name: string;
    statement?: string;
    framework_name?: string;
    framework_code?: string;
  };
  equivalent_count: number;
  analysis: {
    common_requirements: string[];
    unique_requirements: string[];
    stricter_aspects: string[];
    gaps: string[];
    summary: string;
  };
  equivalents: any[];
}

export default function FrameworkComparisonPage() {
  const [selectedFrameworks, setSelectedFrameworks] = useState<number[]>([]);
  const [showFrameworkDropdown, setShowFrameworkDropdown] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [selectedControlPair, setSelectedControlPair] = useState<{
    control1: { type: string; id: number };
    control2: { type: string; id: number };
  } | null>(null);
  const [selectedControlForAI, setSelectedControlForAI] = useState<{
    type: string;
    id: number;
  } | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize] = useState(50);

  const { data: frameworksData, isLoading: frameworksLoading } = useQuery({
    queryKey: ['comparison-frameworks'],
    queryFn: async () => {
      const response = await apiClient.get('/control-library/comparison/frameworks');
      return response.data as { frameworks: FrameworkInfo[] };
    },
  });

  const { data: matrixData, isLoading: matrixLoading } = useQuery({
    queryKey: ['comparison-matrix', selectedFrameworks],
    queryFn: async () => {
      let url = '/control-library/comparison/matrix';
      if (selectedFrameworks.length >= 2) {
        const searchParams = new URLSearchParams();
        selectedFrameworks.forEach(id => searchParams.append('framework_ids', id.toString()));
        url = `${url}?${searchParams.toString()}`;
      }
      const response = await apiClient.get(url);
      return response.data as { frameworks: FrameworkInfo[]; matrix: MatrixRow[] };
    },
    enabled: selectedFrameworks.length >= 2 || selectedFrameworks.length === 0,
  });

  const { data: controlsData, isLoading: controlsLoading, refetch: refetchControls } = useQuery({
    queryKey: ['comparison-controls', selectedFrameworks, page, pageSize],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      selectedFrameworks.forEach(id => searchParams.append('framework_ids', id.toString()));
      searchParams.append('skip', (page * pageSize).toString());
      searchParams.append('limit', pageSize.toString());
      const response = await apiClient.get(`/control-library/comparison/controls?${searchParams.toString()}`);
      return response.data as {
        total: number;
        frameworks: FrameworkInfo[];
        comparison_grid: ComparisonGridItem[];
      };
    },
    enabled: selectedFrameworks.length >= 2,
  });

  const sideBySideMutation = useMutation({
    mutationFn: async (pair: { control1: { type: string; id: number }; control2: { type: string; id: number } }) => {
      const response = await apiClient.post('/control-library/comparison/side-by-side', {
        control_pairs: [
          {
            control1_type: pair.control1.type,
            control1_id: pair.control1.id,
            control2_type: pair.control2.type,
            control2_id: pair.control2.id,
          },
        ],
      });
      return response.data as { comparisons: SideBySideComparison[] };
    },
  });

  const { data: aiDifferenceData, isLoading: aiDifferenceLoading, refetch: refetchAIDifference } = useQuery({
    queryKey: ['ai-difference', selectedControlForAI?.type, selectedControlForAI?.id],
    queryFn: async () => {
      if (!selectedControlForAI) return null;
      const response = await apiClient.get(
        `/control-library/comparison/differences/${selectedControlForAI.type}/${selectedControlForAI.id}`
      );
      return response.data as AIDifferenceAnalysis;
    },
    enabled: !!selectedControlForAI,
  });

  const exportMutation = useMutation({
    mutationFn: async (format: 'csv' | 'xlsx') => {
      const response = await apiClient.post(
        '/control-library/comparison/export-comparison',
        {
          framework_ids: selectedFrameworks,
          format,
        },
        { responseType: 'blob' }
      );
      return { data: response.data, format };
    },
    onSuccess: ({ data, format }) => {
      const blob = new Blob([data], {
        type: format === 'xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv',
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `framework_comparison_${new Date().toISOString().split('T')[0]}.${format}`;
      a.click();
      window.URL.revokeObjectURL(url);
      setShowExportMenu(false);
    },
  });

  const toggleFramework = (id: number) => {
    setSelectedFrameworks((prev) =>
      prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]
    );
    setPage(0);
  };

  const clearSelection = () => {
    setSelectedFrameworks([]);
    setSelectedControlPair(null);
    setSelectedControlForAI(null);
    setPage(0);
  };

  const handleCellClick = (fw1Id: number, fw2Id: number) => {
    if (!selectedFrameworks.includes(fw1Id)) {
      setSelectedFrameworks((prev) => [...prev, fw1Id]);
    }
    if (!selectedFrameworks.includes(fw2Id)) {
      setSelectedFrameworks((prev) => [...prev, fw2Id]);
    }
  };

  const handleControlPairClick = (control1: ControlInfo, control2: ControlInfo) => {
    const pair = {
      control1: { type: 'framework', id: control1.id },
      control2: { type: 'framework', id: control2.id },
    };
    setSelectedControlPair(pair);
    sideBySideMutation.mutate(pair);
  };

  const handleAIAnalysis = (control: ControlInfo) => {
    setSelectedControlForAI({ type: 'framework', id: control.id });
  };

  const getCellColor = (count: number) => {
    if (count === 0) return 'bg-white';
    if (count < 5) return 'bg-blue-900/30';
    if (count < 20) return 'bg-blue-700/40';
    if (count < 50) return 'bg-blue-600/50';
    return 'bg-blue-500/60';
  };

  const getSimilarityColor = (score: number) => {
    if (score >= 0.8) return 'text-green-400';
    if (score >= 0.5) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getSimilarityBg = (score: number) => {
    if (score >= 0.8) return 'bg-green-500/20';
    if (score >= 0.5) return 'bg-yellow-500/20';
    return 'bg-red-500/20';
  };

  const selectedFrameworkNames = frameworksData?.frameworks
    .filter((f) => selectedFrameworks.includes(f.id))
    .map((f) => f.short_code)
    .join(', ');

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Framework Comparison</h1>
          <p className="text-slate-400">Compare controls across regulatory frameworks</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {selectedFrameworks.length >= 2 && (
            <div className="relative">
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
                disabled={exportMutation.isPending}
              >
                {exportMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Export
                <ChevronDown className="h-4 w-4" />
              </button>
              {showExportMenu && (
                <div className="absolute right-0 top-full z-20 mt-2 w-40 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                  <button
                    onClick={() => exportMutation.mutate('csv')}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-slate-600 hover:bg-slate-200"
                  >
                    <FileText className="h-4 w-4" />
                    Export CSV
                  </button>
                  <button
                    onClick={() => exportMutation.mutate('xlsx')}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-slate-600 hover:bg-slate-200"
                  >
                    <FileText className="h-4 w-4" />
                    Export Excel
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 items-center gap-3">
            <div className="relative">
              <button
                onClick={() => setShowFrameworkDropdown(!showFrameworkDropdown)}
                className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-slate-800 hover:border-slate-400"
              >
                <Layers className="h-4 w-4 text-slate-400" />
                {selectedFrameworks.length === 0
                  ? 'Select Frameworks (2+ required)'
                  : `${selectedFrameworks.length} frameworks selected`}
                <ChevronDown className="h-4 w-4 text-slate-400" />
              </button>
              {showFrameworkDropdown && (
                <div className="absolute left-0 top-full z-20 mt-2 max-h-80 w-80 overflow-auto rounded-lg border border-slate-200 bg-white py-2 shadow-lg">
                  {frameworksLoading ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="h-5 w-5 animate-spin text-primary-400" />
                    </div>
                  ) : (
                    frameworksData?.frameworks.map((fw) => (
                      <button
                        key={fw.id}
                        onClick={() => toggleFramework(fw.id)}
                        className={`flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-slate-200 ${
                          selectedFrameworks.includes(fw.id) ? 'bg-slate-200/50' : ''
                        }`}
                      >
                        <div
                          className={`flex h-5 w-5 items-center justify-center rounded border ${
                            selectedFrameworks.includes(fw.id)
                              ? 'border-primary-500 bg-primary-500'
                              : 'border-slate-300'
                          }`}
                        >
                          {selectedFrameworks.includes(fw.id) && (
                            <CheckCircle className="h-3 w-3 text-slate-800" />
                          )}
                        </div>
                        <div className="flex-1">
                          <p className="font-medium text-slate-800">{fw.short_code}</p>
                          <p className="text-xs text-slate-400 truncate">{fw.name}</p>
                        </div>
                        <span className="text-xs text-slate-500">{fw.control_count} controls</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            {selectedFrameworks.length > 0 && (
              <button
                onClick={clearSelection}
                className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-400 hover:border-slate-400 hover:text-slate-900"
              >
                <X className="h-4 w-4" />
                Clear
              </button>
            )}
          </div>
          {selectedFrameworkNames && (
            <p className="text-sm text-slate-400">
              Comparing: <span className="text-primary-400">{selectedFrameworkNames}</span>
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-gradient-to-br from-primary-500/20 to-primary-600/10 p-3">
              <Shield className="h-6 w-6 text-primary-400" />
            </div>
          </div>
          <p className="stat-value">{frameworksData?.frameworks.length || 0}</p>
          <p className="stat-label">Available Frameworks</p>
        </div>
        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-gradient-to-br from-blue-500/20 to-blue-600/10 p-3">
              <GitCompare className="h-6 w-6 text-blue-400" />
            </div>
          </div>
          <p className="stat-value">{selectedFrameworks.length}</p>
          <p className="stat-label">Frameworks Selected</p>
        </div>
        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-gradient-to-br from-green-500/20 to-green-600/10 p-3">
              <Layers className="h-6 w-6 text-green-400" />
            </div>
          </div>
          <p className="stat-value">{controlsData?.comparison_grid?.length || 0}</p>
          <p className="stat-label">Shared Control Groups</p>
        </div>
        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-gradient-to-br from-purple-500/20 to-purple-600/10 p-3">
              <Grid3X3 className="h-6 w-6 text-primary-600" />
            </div>
          </div>
          <p className="stat-value">{controlsData?.total || 0}</p>
          <p className="stat-label">Total Comparison Items</p>
        </div>
      </div>

      {(selectedFrameworks.length === 0 || selectedFrameworks.length >= 2) && (
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title flex items-center gap-2">
                <Grid3X3 className="h-5 w-5 text-primary-400" />
                Comparison Matrix
              </h2>
              <p className="card-description">Click on a cell to compare frameworks</p>
            </div>
          </div>
          {matrixLoading ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
            </div>
          ) : !matrixData?.matrix?.length ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Grid3X3 className="mb-4 h-12 w-12 text-slate-600" />
              <h3 className="text-lg font-medium text-slate-800">No matrix data available</h3>
              <p className="mt-1 text-slate-400">Select at least 2 frameworks to see the comparison matrix</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-slate-400"></th>
                    {matrixData.frameworks.map((fw) => (
                      <th key={fw.id} className="px-3 py-2 text-center text-xs font-medium uppercase text-slate-400">
                        {fw.short_code}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrixData.matrix.map((row) => (
                    <tr key={row.framework_id}>
                      <td className="px-3 py-2 text-sm font-medium text-slate-800">{row.framework_code}</td>
                      {matrixData.frameworks.map((fw) => {
                        const cell = row.mappings[fw.id];
                        if (cell === null) {
                          return (
                            <td key={fw.id} className="px-3 py-2 text-center">
                              <div className="mx-auto h-12 w-12 rounded bg-slate-200/50" />
                            </td>
                          );
                        }
                        return (
                          <td key={fw.id} className="px-3 py-2 text-center">
                            <button
                              onClick={() => handleCellClick(row.framework_id, fw.id)}
                              className={`mx-auto flex h-12 w-12 items-center justify-center rounded ${getCellColor(
                                cell?.shared_mappings || 0
                              )} transition-all hover:ring-2 hover:ring-primary-500`}
                            >
                              <span className="text-sm font-medium text-slate-800">
                                {cell?.shared_mappings || 0}
                              </span>
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {selectedFrameworks.length >= 2 && (
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title flex items-center gap-2">
                <GitCompare className="h-5 w-5 text-blue-400" />
                Controls Comparison
              </h2>
              <p className="card-description">Controls grouped by common control groups</p>
            </div>
          </div>
          {controlsLoading ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
            </div>
          ) : !controlsData?.comparison_grid?.length ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <GitCompare className="mb-4 h-12 w-12 text-slate-600" />
              <h3 className="text-lg font-medium text-slate-800">No Common Control Groups Found</h3>
              <p className="mt-2 max-w-md text-slate-400">
                To compare controls across frameworks, you need to first create Common Control Groups 
                that link similar controls together.
              </p>
              <div className="mt-6 flex flex-col items-center gap-4">
                <a
                  href="/control-library"
                  className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
                >
                  <Layers className="h-4 w-4" />
                  Go to Control Groups
                </a>
                <p className="text-xs text-slate-500">
                  Use "Auto-Group Similar Controls" to automatically create groups using AI
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-400">Group</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-400">Category</th>
                      {controlsData.frameworks.map((fw) => (
                        <th key={fw.id} className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-400">
                          {fw.short_code}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700">
                    {controlsData.comparison_grid.map((item) => (
                      <tr key={item.group_id} className="hover:bg-slate-200/30">
                        <td className="px-4 py-3">
                          <div>
                            <p className="font-mono text-sm font-medium text-primary-400">{item.group_code}</p>
                            <p className="text-xs text-slate-400 truncate max-w-xs">{item.group_name}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="rounded-full bg-slate-200 px-2 py-1 text-xs text-slate-600">
                            {item.category || 'General'}
                          </span>
                        </td>
                        {controlsData.frameworks.map((fw) => {
                          const controls = item.framework_controls[fw.id] || [];
                          return (
                            <td key={fw.id} className="px-4 py-3">
                              {controls.length === 0 ? (
                                <span className="text-xs text-slate-500">-</span>
                              ) : (
                                <div className="flex flex-wrap gap-1">
                                  {controls.map((ctrl) => (
                                    <button
                                      key={ctrl.id}
                                      onClick={() => {
                                        const otherFw = controlsData.frameworks.find((f) => f.id !== fw.id);
                                        const otherControls = otherFw ? item.framework_controls[otherFw.id] : [];
                                        if (otherControls?.length > 0) {
                                          handleControlPairClick(ctrl, otherControls[0]);
                                        } else {
                                          handleAIAnalysis(ctrl);
                                        }
                                      }}
                                      className="rounded bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-800 hover:bg-primary-600 transition-colors"
                                      title={ctrl.name}
                                    >
                                      {ctrl.code}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {controlsData.total > pageSize && (
                <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-4">
                  <p className="text-sm text-slate-400">
                    Showing {page * pageSize + 1} to {Math.min((page + 1) * pageSize, controlsData.total)} of{' '}
                    {controlsData.total}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="rounded-lg border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-200 disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <button
                      onClick={() => setPage((p) => p + 1)}
                      disabled={(page + 1) * pageSize >= controlsData.total}
                      className="rounded-lg border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:bg-slate-200 disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {selectedControlPair && sideBySideMutation.data && (
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <div>
              <h2 className="card-title flex items-center gap-2">
                <ArrowRight className="h-5 w-5 text-green-400" />
                Side-by-Side Comparison
              </h2>
              <p className="card-description">Detailed comparison of selected control pair</p>
            </div>
            <button
              onClick={() => setSelectedControlPair(null)}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-900"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {sideBySideMutation.isPending ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
            </div>
          ) : sideBySideMutation.data.comparisons.length === 0 ? (
            <p className="text-slate-400">No comparison data available</p>
          ) : (
            sideBySideMutation.data.comparisons.map((comparison, idx) => (
              <div key={idx} className="space-y-6">
                {comparison.error ? (
                  <div className="flex items-center gap-2 rounded-lg bg-red-500/10 p-4 text-red-400">
                    <AlertCircle className="h-5 w-5" />
                    {comparison.error}
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                      <div className="rounded-lg border border-slate-200 bg-white/50 p-4">
                        <div className="mb-3 flex items-center gap-2">
                          <Shield className="h-4 w-4 text-blue-400" />
                          <span className="text-xs font-medium text-blue-400">
                            {comparison.control1.framework_code || 'Control 1'}
                          </span>
                        </div>
                        <h4 className="font-mono text-lg font-bold text-slate-800">{comparison.control1.code}</h4>
                        <p className="mt-1 text-sm text-slate-600">{comparison.control1.name}</p>
                        {comparison.control1.statement && (
                          <p className="mt-3 text-xs text-slate-400 line-clamp-4">{comparison.control1.statement}</p>
                        )}
                      </div>

                      <div className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-white/50 p-4">
                        <div
                          className={`mb-3 flex h-16 w-16 items-center justify-center rounded-full ${getSimilarityBg(
                            comparison.comparison.similarity_score
                          )}`}
                        >
                          <span className={`text-xl font-bold ${getSimilarityColor(comparison.comparison.similarity_score)}`}>
                            {Math.round(comparison.comparison.similarity_score * 100)}%
                          </span>
                        </div>
                        <p className="text-sm text-slate-400">Similarity Score</p>
                        {comparison.comparison.common_keywords.length > 0 && (
                          <div className="mt-4">
                            <p className="mb-2 text-xs font-medium text-slate-400">Common Keywords</p>
                            <div className="flex flex-wrap justify-center gap-1">
                              {comparison.comparison.common_keywords.slice(0, 5).map((kw, i) => (
                                <span key={i} className="rounded bg-slate-200 px-2 py-0.5 text-xs text-slate-600">
                                  {kw}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="rounded-lg border border-slate-200 bg-white/50 p-4">
                        <div className="mb-3 flex items-center gap-2">
                          <Shield className="h-4 w-4 text-primary-600" />
                          <span className="text-xs font-medium text-primary-600">
                            {comparison.control2.framework_code || 'Control 2'}
                          </span>
                        </div>
                        <h4 className="font-mono text-lg font-bold text-slate-800">{comparison.control2.code}</h4>
                        <p className="mt-1 text-sm text-slate-600">{comparison.control2.name}</p>
                        {comparison.control2.statement && (
                          <p className="mt-3 text-xs text-slate-400 line-clamp-4">{comparison.control2.statement}</p>
                        )}
                      </div>
                    </div>

                    {comparison.comparison.differences.length > 0 && (
                      <div className="rounded-lg border border-slate-200 bg-white/50 p-4">
                        <h4 className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-800">
                          <XCircle className="h-4 w-4 text-orange-400" />
                          Key Differences
                        </h4>
                        <ul className="space-y-2">
                          {comparison.comparison.differences.map((diff, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-orange-400" />
                              {diff}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      {comparison.comparison.control1_unique.length > 0 && (
                        <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-4">
                          <h4 className="mb-2 text-sm font-medium text-blue-400">
                            Unique to {comparison.control1.code}
                          </h4>
                          <ul className="space-y-1">
                            {comparison.comparison.control1_unique.map((item, i) => (
                              <li key={i} className="text-sm text-slate-600">• {item}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {comparison.comparison.control2_unique.length > 0 && (
                        <div className="rounded-lg border border-primary-500/30 bg-primary-500/10 p-4">
                          <h4 className="mb-2 text-sm font-medium text-primary-600">
                            Unique to {comparison.control2.code}
                          </h4>
                          <ul className="space-y-1">
                            {comparison.comparison.control2_unique.map((item, i) => (
                              <li key={i} className="text-sm text-slate-600">• {item}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      {comparison.comparison.control1_stricter.length > 0 && (
                        <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4">
                          <h4 className="mb-2 text-sm font-medium text-green-400">
                            {comparison.control1.code} is stricter on
                          </h4>
                          <ul className="space-y-1">
                            {comparison.comparison.control1_stricter.map((item, i) => (
                              <li key={i} className="text-sm text-slate-600">• {item}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {comparison.comparison.control2_stricter.length > 0 && (
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
                          <h4 className="mb-2 text-sm font-medium text-amber-400">
                            {comparison.control2.code} is stricter on
                          </h4>
                          <ul className="space-y-1">
                            {comparison.comparison.control2_stricter.map((item, i) => (
                              <li key={i} className="text-sm text-slate-600">• {item}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {selectedControlForAI && (
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <div>
              <h2 className="card-title flex items-center gap-2">
                <Brain className="h-5 w-5 text-primary-600" />
                AI Difference Analysis
              </h2>
              <p className="card-description">AI-powered analysis of control differences across frameworks</p>
            </div>
            <button
              onClick={() => setSelectedControlForAI(null)}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-900"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {aiDifferenceLoading ? (
            <div className="flex h-48 items-center justify-center">
              <div className="text-center">
                <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary-400" />
                <p className="mt-2 text-sm text-slate-400">Analyzing with AI...</p>
              </div>
            </div>
          ) : !aiDifferenceData ? (
            <p className="text-slate-400">No analysis data available</p>
          ) : (
            <div className="space-y-6">
              <div className="flex items-start gap-4 rounded-lg border border-slate-200 bg-white/50 p-4">
                <div className="rounded-lg bg-primary-500/20 p-3">
                  <Shield className="h-6 w-6 text-primary-400" />
                </div>
                <div className="flex-1">
                  <h4 className="font-mono text-lg font-bold text-slate-800">{aiDifferenceData.control.code}</h4>
                  <p className="text-sm text-slate-600">{aiDifferenceData.control.name}</p>
                  {aiDifferenceData.control.framework_code && (
                    <span className="mt-2 inline-block rounded bg-slate-200 px-2 py-0.5 text-xs text-slate-600">
                      {aiDifferenceData.control.framework_code}
                    </span>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-primary-400">{aiDifferenceData.equivalent_count}</p>
                  <p className="text-xs text-slate-400">Equivalent Controls</p>
                </div>
              </div>

              {aiDifferenceData.analysis.summary && (
                <div className="rounded-lg border border-slate-200 bg-white/50 p-4">
                  <h4 className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-800">
                    <Sparkles className="h-4 w-4 text-yellow-400" />
                    Summary
                  </h4>
                  <p className="text-sm text-slate-600">{aiDifferenceData.analysis.summary}</p>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {aiDifferenceData.analysis.common_requirements.length > 0 && (
                  <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4">
                    <h4 className="mb-3 flex items-center gap-2 text-sm font-medium text-green-400">
                      <CheckCircle className="h-4 w-4" />
                      Common Requirements
                    </h4>
                    <ul className="space-y-2">
                      {aiDifferenceData.analysis.common_requirements.map((req, i) => (
                        <li key={i} className="text-sm text-slate-600">• {req}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {aiDifferenceData.analysis.unique_requirements.length > 0 && (
                  <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-4">
                    <h4 className="mb-3 flex items-center gap-2 text-sm font-medium text-blue-400">
                      <Sparkles className="h-4 w-4" />
                      Unique Requirements
                    </h4>
                    <ul className="space-y-2">
                      {aiDifferenceData.analysis.unique_requirements.map((req, i) => (
                        <li key={i} className="text-sm text-slate-600">• {req}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {aiDifferenceData.analysis.stricter_aspects.length > 0 && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
                    <h4 className="mb-3 flex items-center gap-2 text-sm font-medium text-amber-400">
                      <AlertCircle className="h-4 w-4" />
                      Stricter Aspects
                    </h4>
                    <ul className="space-y-2">
                      {aiDifferenceData.analysis.stricter_aspects.map((aspect, i) => (
                        <li key={i} className="text-sm text-slate-600">• {aspect}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {aiDifferenceData.analysis.gaps.length > 0 && (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
                    <h4 className="mb-3 flex items-center gap-2 text-sm font-medium text-red-400">
                      <XCircle className="h-4 w-4" />
                      Gaps
                    </h4>
                    <ul className="space-y-2">
                      {aiDifferenceData.analysis.gaps.map((gap, i) => (
                        <li key={i} className="text-sm text-slate-600">• {gap}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {aiDifferenceData.equivalents.length > 0 && (
                <div className="rounded-lg border border-slate-200 bg-white/50 p-4">
                  <h4 className="mb-3 text-sm font-medium text-slate-800">Equivalent Controls</h4>
                  <div className="flex flex-wrap gap-2">
                    {aiDifferenceData.equivalents.map((eq, i) => (
                      <div
                        key={i}
                        className="rounded-lg border border-slate-300 bg-slate-200 px-3 py-2"
                      >
                        <p className="font-mono text-sm font-medium text-primary-400">{eq.code}</p>
                        <p className="text-xs text-slate-400">{eq.framework_code || eq.type}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {selectedFrameworks.length === 1 && (
        <div className="card flex flex-col items-center justify-center py-12 text-center">
          <GitCompare className="mb-4 h-12 w-12 text-slate-600" />
          <h3 className="text-lg font-medium text-slate-800">Select at least 2 frameworks</h3>
          <p className="mt-1 text-slate-400">Choose one more framework to start comparing controls</p>
        </div>
      )}
    </div>
  );
}
