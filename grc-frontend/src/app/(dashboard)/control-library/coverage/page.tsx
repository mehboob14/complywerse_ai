'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import {
  Grid3X3,
  Shield,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Download,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  FileText,
  Plus,
  X,
  Layers,
  TrendingUp,
  BarChart3,
  Info,
} from 'lucide-react';

interface CoverageMatrix {
  frameworks: Array<{
    framework_id: number;
    framework_name: string;
    framework_code: string;
    total_controls: number;
    covered_controls: number;
    coverage_percent: number;
    categories: Record<string, {
      controls_total: number;
      controls_with_evidence: number;
      coverage_percent: number;
    }>;
  }>;
  categories: string[];
}

interface FrameworkCoverage {
  framework_id: number;
  framework_name: string;
  framework_code: string;
  total_controls: number;
  covered_controls: number;
  coverage_percent: number;
  by_category: Array<{
    category_name: string;
    total_controls: number;
    covered_controls: number;
    coverage_percent: number;
  }>;
}

interface CategoryCoverage {
  category_name: string;
  total_controls: number;
  covered_controls: number;
  coverage_percent: number;
  frameworks: Array<{
    framework_id: number;
    framework_name: string;
    total_controls: number;
    covered_controls: number;
    coverage_percent: number;
  }>;
}

interface HeatmapData {
  rows: Array<{ id: number; name: string; code: string }>;
  columns: string[];
  values: Array<Array<{
    value: number;
    color: string;
    controls_total: number;
    controls_with_evidence: number;
  }>>;
  color_scale: {
    red: { min: number; max: number; label: string };
    yellow: { min: number; max: number; label: string };
    green: { min: number; max: number; label: string };
  };
}

interface FrameworkDetail {
  framework_id: number;
  framework_name: string;
  framework_code: string;
  total_controls: number;
  covered_controls: number;
  uncovered_controls: number;
  coverage_percent: number;
  uncovered_control_list: Array<{
    id: number;
    code: string;
    name: string;
    domain: string;
    objective: string;
  }>;
  by_domain: Array<{
    domain_id: number;
    domain_code: string;
    domain_name: string;
    total_controls: number;
    covered_controls: number;
    coverage_percent: number;
  }>;
  by_category: Array<{
    category_name: string;
    total_controls: number;
    covered_controls: number;
    coverage_percent: number;
  }>;
}

interface AuditSavings {
  total_evidence: number;
  multi_framework_evidence: number;
  single_framework_effort: number;
  actual_effort: number;
  savings_percent: number;
  controls_covered: number;
  average_controls_per_evidence: number;
}

export default function CoverageMatrixPage() {
  const [selectedCell, setSelectedCell] = useState<{
    frameworkId: number;
    frameworkName: string;
    frameworkCode: string;
    category: string;
    coverage: number;
    controlsTotal: number;
    controlsWithEvidence: number;
  } | null>(null);
  const [expandedFramework, setExpandedFramework] = useState<number | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [hoveredCell, setHoveredCell] = useState<{ row: number; col: number } | null>(null);

  const { data: matrixData, isLoading: matrixLoading } = useQuery({
    queryKey: ['coverage-matrix'],
    queryFn: async () => {
      const response = await apiClient.get('/control-library/coverage/matrix');
      return response.data as CoverageMatrix;
    },
  });

  const { data: heatmapData, isLoading: heatmapLoading } = useQuery({
    queryKey: ['coverage-heatmap'],
    queryFn: async () => {
      const response = await apiClient.get('/control-library/coverage/heatmap-data');
      return response.data as HeatmapData;
    },
  });

  const { data: byFrameworkData } = useQuery({
    queryKey: ['coverage-by-framework'],
    queryFn: async () => {
      const response = await apiClient.get('/control-library/coverage/by-framework');
      return response.data as { frameworks: FrameworkCoverage[] };
    },
  });

  const { data: byCategoryData } = useQuery({
    queryKey: ['coverage-by-category'],
    queryFn: async () => {
      const response = await apiClient.get('/control-library/coverage/by-category');
      return response.data as { categories: CategoryCoverage[] };
    },
  });

  const { data: auditSavings } = useQuery({
    queryKey: ['audit-savings'],
    queryFn: async () => {
      const response = await apiClient.get('/control-library/coverage/audit-savings');
      return response.data as AuditSavings;
    },
  });

  const { data: frameworkDetail, isLoading: frameworkDetailLoading } = useQuery({
    queryKey: ['framework-coverage-detail', selectedCell?.frameworkId],
    queryFn: async () => {
      if (!selectedCell?.frameworkId) return null;
      const response = await apiClient.get(`/control-library/coverage/framework/${selectedCell.frameworkId}`);
      return response.data as FrameworkDetail;
    },
    enabled: !!selectedCell?.frameworkId,
  });

  const summaryStats = useMemo(() => {
    if (!matrixData) return null;

    const totalControls = matrixData.frameworks.reduce((sum, fw) => sum + fw.total_controls, 0);
    const coveredControls = matrixData.frameworks.reduce((sum, fw) => sum + fw.covered_controls, 0);
    const overallCoverage = totalControls > 0 ? Math.round((coveredControls / totalControls) * 100) : 0;
    const fullyCompliantFrameworks = matrixData.frameworks.filter(fw => fw.coverage_percent === 100).length;
    
    const categoriesWithGaps = new Set<string>();
    matrixData.frameworks.forEach(fw => {
      Object.entries(fw.categories).forEach(([cat, data]) => {
        if (data.coverage_percent < 100) {
          categoriesWithGaps.add(cat);
        }
      });
    });

    return {
      overallCoverage,
      fullyCompliantFrameworks,
      categoriesWithGaps: categoriesWithGaps.size,
      totalEvidence: auditSavings?.total_evidence || 0,
    };
  }, [matrixData, auditSavings]);

  const exportMutation = useMutation({
    mutationFn: async () => {
      const response = await apiClient.get('/control-library/coverage/matrix');
      return response.data;
    },
    onSuccess: (data) => {
      const csvRows = [];
      csvRows.push(['Framework', 'Category', 'Total Controls', 'Covered Controls', 'Coverage %']);
      
      (data as CoverageMatrix).frameworks.forEach(fw => {
        Object.entries(fw.categories).forEach(([cat, catData]) => {
          csvRows.push([
            fw.framework_code,
            cat,
            catData.controls_total.toString(),
            catData.controls_with_evidence.toString(),
            catData.coverage_percent.toString(),
          ]);
        });
      });

      const csvContent = csvRows.map(row => row.join(',')).join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `coverage_matrix_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
      setShowExportMenu(false);
    },
  });

  const getCoverageColor = (percentage: number) => {
    if (percentage <= 33) return 'bg-red-500';
    if (percentage <= 66) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const getCoverageTextColor = (percentage: number) => {
    if (percentage <= 33) return 'text-red-400';
    if (percentage <= 66) return 'text-yellow-400';
    return 'text-green-400';
  };

  const getCoverageBgColor = (percentage: number) => {
    if (percentage <= 33) return 'bg-red-500/20';
    if (percentage <= 66) return 'bg-yellow-500/20';
    return 'bg-green-500/20';
  };

  const handleCellClick = (
    frameworkId: number,
    frameworkName: string,
    frameworkCode: string,
    category: string,
    coverage: number,
    controlsTotal: number,
    controlsWithEvidence: number
  ) => {
    setSelectedCell({
      frameworkId,
      frameworkName,
      frameworkCode,
      category,
      coverage,
      controlsTotal,
      controlsWithEvidence,
    });
  };

  const closeModal = () => {
    setSelectedCell(null);
  };

  const isLoading = matrixLoading || heatmapLoading;

  if (isLoading) {
    return (
      <div className="space-y-8">
        <div className="page-header">
          <div className="skeleton h-8 w-64 mb-2" />
          <div className="skeleton h-5 w-96" />
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="stat-card">
              <div className="skeleton h-12 w-12 rounded-xl mb-4" />
              <div className="skeleton h-8 w-20 mb-2" />
              <div className="skeleton h-4 w-32" />
            </div>
          ))}
        </div>
        <div className="card">
          <div className="skeleton h-6 w-48 mb-4" />
          <div className="skeleton h-64 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Compliance Coverage Matrix</h1>
          <p className="text-slate-400">Evidence coverage across frameworks and categories</p>
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
            Export Matrix
            <ChevronDown className="h-4 w-4" />
          </button>
          {showExportMenu && (
            <div className="absolute right-0 top-full z-10 mt-2 w-40 rounded-lg border border-slate-700 bg-slate-800 py-1 shadow-lg">
              <button
                onClick={() => exportMutation.mutate()}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-slate-300 hover:bg-slate-700"
              >
                <FileText className="h-4 w-4" />
                Export as CSV
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="stat-card">
          <div className="flex items-start justify-between mb-4">
            <div className="rounded-xl bg-gradient-to-br from-primary-500/20 to-primary-600/10 p-3">
              <TrendingUp className="h-6 w-6 text-primary-400" />
            </div>
            {summaryStats && (
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${getCoverageBgColor(summaryStats.overallCoverage)} ${getCoverageTextColor(summaryStats.overallCoverage)}`}>
                {summaryStats.overallCoverage}%
              </span>
            )}
          </div>
          <p className="stat-value">{summaryStats?.overallCoverage || 0}%</p>
          <p className="stat-label">Overall Coverage</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between mb-4">
            <div className="rounded-xl bg-gradient-to-br from-green-500/20 to-green-600/10 p-3">
              <CheckCircle className="h-6 w-6 text-green-400" />
            </div>
          </div>
          <p className="stat-value">{summaryStats?.fullyCompliantFrameworks || 0}</p>
          <p className="stat-label">Frameworks Fully Covered</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between mb-4">
            <div className="rounded-xl bg-gradient-to-br from-orange-500/20 to-orange-600/10 p-3">
              <AlertTriangle className="h-6 w-6 text-orange-400" />
            </div>
          </div>
          <p className="stat-value">{summaryStats?.categoriesWithGaps || 0}</p>
          <p className="stat-label">Categories with Gaps</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between mb-4">
            <div className="rounded-xl bg-gradient-to-br from-cyan-500/20 to-cyan-600/10 p-3">
              <FileText className="h-6 w-6 text-cyan-400" />
            </div>
          </div>
          <p className="stat-value">{summaryStats?.totalEvidence || 0}</p>
          <p className="stat-label">Evidence Items Total</p>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title flex items-center gap-2">
              <Grid3X3 className="h-5 w-5 text-primary-400" />
              Coverage Heatmap
            </h2>
            <p className="card-description">Click on a cell to see detailed coverage information</p>
          </div>
        </div>

        {!heatmapData?.rows?.length ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <BarChart3 className="mb-4 h-12 w-12 text-slate-600" />
            <h3 className="text-lg font-medium text-white">No coverage data available</h3>
            <p className="mt-1 text-slate-400">Add frameworks and evidence to see the coverage matrix</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <div className="min-w-max">
                <div
                  className="grid gap-1"
                  style={{
                    gridTemplateColumns: `200px repeat(${heatmapData.columns.length}, minmax(80px, 1fr))`,
                  }}
                >
                  <div className="p-2 text-xs font-medium uppercase text-slate-400"></div>
                  {heatmapData.columns.map((col, colIdx) => (
                    <div
                      key={colIdx}
                      className="p-2 text-center text-xs font-medium uppercase text-slate-400 truncate"
                      title={col}
                    >
                      {col.length > 15 ? col.substring(0, 15) + '...' : col}
                    </div>
                  ))}

                  {heatmapData.rows.map((row, rowIdx) => (
                    <>
                      <div key={`row-${rowIdx}`} className="flex items-center gap-2 p-2">
                        <Shield className="h-4 w-4 text-slate-400" />
                        <div className="truncate">
                          <span className="font-medium text-white text-sm">{row.code}</span>
                        </div>
                      </div>
                      {heatmapData.values[rowIdx]?.map((cell, colIdx) => (
                        <div
                          key={`cell-${rowIdx}-${colIdx}`}
                          className="relative"
                          onMouseEnter={() => setHoveredCell({ row: rowIdx, col: colIdx })}
                          onMouseLeave={() => setHoveredCell(null)}
                        >
                          <button
                            onClick={() =>
                              handleCellClick(
                                row.id,
                                row.name,
                                row.code,
                                heatmapData.columns[colIdx],
                                cell.value,
                                cell.controls_total,
                                cell.controls_with_evidence
                              )
                            }
                            className={`w-full h-12 rounded flex items-center justify-center transition-all hover:ring-2 hover:ring-primary-500 ${getCoverageColor(cell.value)}`}
                          >
                            <span className="text-xs font-bold text-white drop-shadow-md">
                              {cell.value}%
                            </span>
                          </button>
                          {hoveredCell?.row === rowIdx && hoveredCell?.col === colIdx && (
                            <div className="absolute bottom-full left-1/2 z-20 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-3 py-2 text-xs shadow-lg border border-slate-700">
                              <p className="font-medium text-white">{row.code} × {heatmapData.columns[colIdx]}</p>
                              <p className={getCoverageTextColor(cell.value)}>
                                {cell.value}% Coverage
                              </p>
                              <p className="text-slate-400">
                                {cell.controls_with_evidence} / {cell.controls_total} controls
                              </p>
                            </div>
                          )}
                        </div>
                      ))}
                    </>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-center gap-6 border-t border-slate-700 pt-4">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-slate-400" />
                <span className="text-xs text-slate-400">Legend:</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-4 w-8 rounded bg-red-500"></div>
                <span className="text-xs text-slate-400">0-33% (Low)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-4 w-8 rounded bg-yellow-500"></div>
                <span className="text-xs text-slate-400">34-66% (Partial)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-4 w-8 rounded bg-green-500"></div>
                <span className="text-xs text-slate-400">67-100% (Good)</span>
              </div>
            </div>
          </>
        )}
      </div>

      {byFrameworkData?.frameworks && byFrameworkData.frameworks.length > 0 && (
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title flex items-center gap-2">
                <Shield className="h-5 w-5 text-blue-400" />
                Framework Coverage Details
              </h2>
              <p className="card-description">Expand to see coverage breakdown by framework</p>
            </div>
          </div>
          <div className="space-y-2">
            {byFrameworkData.frameworks.map((fw) => (
              <div key={fw.framework_id} className="rounded-lg border border-slate-700 overflow-hidden">
                <button
                  onClick={() => setExpandedFramework(expandedFramework === fw.framework_id ? null : fw.framework_id)}
                  className="w-full flex items-center justify-between p-4 hover:bg-slate-700/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-700">
                      <Shield className="h-5 w-5 text-slate-400" />
                    </div>
                    <div className="text-left">
                      <p className="font-medium text-white">{fw.framework_code}</p>
                      <p className="text-xs text-slate-400">{fw.framework_name}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className={`text-lg font-bold ${getCoverageTextColor(fw.coverage_percent)}`}>
                        {fw.coverage_percent}%
                      </p>
                      <p className="text-xs text-slate-400">
                        {fw.covered_controls} / {fw.total_controls} controls
                      </p>
                    </div>
                    <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-700">
                      <div
                        className={`h-full transition-all ${getCoverageColor(fw.coverage_percent)}`}
                        style={{ width: `${fw.coverage_percent}%` }}
                      />
                    </div>
                    {expandedFramework === fw.framework_id ? (
                      <ChevronDown className="h-5 w-5 text-slate-400" />
                    ) : (
                      <ChevronRight className="h-5 w-5 text-slate-400" />
                    )}
                  </div>
                </button>
                {expandedFramework === fw.framework_id && (
                  <div className="border-t border-slate-700 p-4 bg-slate-800/50">
                    <h4 className="text-sm font-medium text-slate-300 mb-3">Coverage by Category</h4>
                    <div className="space-y-2">
                      {fw.by_category.map((cat, idx) => (
                        <div key={idx} className="flex items-center gap-3">
                          <span className="text-sm text-slate-400 w-40 truncate" title={cat.category_name}>
                            {cat.category_name}
                          </span>
                          <div className="flex-1 h-2 overflow-hidden rounded-full bg-slate-700">
                            <div
                              className={`h-full transition-all ${getCoverageColor(cat.coverage_percent)}`}
                              style={{ width: `${cat.coverage_percent}%` }}
                            />
                          </div>
                          <span className={`text-sm font-medium w-16 text-right ${getCoverageTextColor(cat.coverage_percent)}`}>
                            {cat.coverage_percent}%
                          </span>
                          <span className="text-xs text-slate-500 w-20 text-right">
                            {cat.covered_controls}/{cat.total_controls}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {byCategoryData?.categories && byCategoryData.categories.length > 0 && (
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title flex items-center gap-2">
                <Layers className="h-5 w-5 text-purple-400" />
                Category Coverage Details
              </h2>
              <p className="card-description">Coverage breakdown by category/domain</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-400">Category</th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase text-slate-400">Total Controls</th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase text-slate-400">Covered</th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase text-slate-400">Coverage</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-400">Progress</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {byCategoryData.categories.map((cat, idx) => (
                  <tr key={idx} className="hover:bg-slate-700/50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-white truncate max-w-xs" title={cat.category_name}>
                        {cat.category_name}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-center text-slate-300">{cat.total_controls}</td>
                    <td className="px-4 py-3 text-center text-green-400">{cat.covered_controls}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`font-medium ${getCoverageTextColor(cat.coverage_percent)}`}>
                        {cat.coverage_percent}%
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-2 w-32 overflow-hidden rounded-full bg-slate-700">
                        <div
                          className={`h-full transition-all ${getCoverageColor(cat.coverage_percent)}`}
                          style={{ width: `${cat.coverage_percent}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedCell && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl max-h-[80vh] overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-700 p-4">
              <div>
                <h3 className="text-lg font-semibold text-white">
                  {selectedCell.frameworkCode} × {selectedCell.category}
                </h3>
                <p className="text-sm text-slate-400">Coverage Details</p>
              </div>
              <button
                onClick={closeModal}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-700 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[60vh]">
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="rounded-lg bg-slate-800 p-4 text-center">
                  <p className={`text-2xl font-bold ${getCoverageTextColor(selectedCell.coverage)}`}>
                    {selectedCell.coverage}%
                  </p>
                  <p className="text-xs text-slate-400">Coverage</p>
                </div>
                <div className="rounded-lg bg-slate-800 p-4 text-center">
                  <p className="text-2xl font-bold text-green-400">{selectedCell.controlsWithEvidence}</p>
                  <p className="text-xs text-slate-400">With Evidence</p>
                </div>
                <div className="rounded-lg bg-slate-800 p-4 text-center">
                  <p className="text-2xl font-bold text-red-400">
                    {selectedCell.controlsTotal - selectedCell.controlsWithEvidence}
                  </p>
                  <p className="text-xs text-slate-400">Missing Evidence</p>
                </div>
              </div>

              <div className="mb-4">
                <div className="h-3 w-full overflow-hidden rounded-full bg-slate-700">
                  <div
                    className={`h-full transition-all ${getCoverageColor(selectedCell.coverage)}`}
                    style={{ width: `${selectedCell.coverage}%` }}
                  />
                </div>
              </div>

              {frameworkDetailLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
                </div>
              ) : frameworkDetail?.uncovered_control_list && frameworkDetail.uncovered_control_list.length > 0 ? (
                <div>
                  <h4 className="text-sm font-medium text-slate-300 mb-3">
                    Uncovered Controls ({frameworkDetail.uncovered_control_list.length})
                  </h4>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {frameworkDetail.uncovered_control_list
                      .filter(ctrl => ctrl.domain === selectedCell.category || !selectedCell.category)
                      .slice(0, 20)
                      .map((ctrl) => (
                        <div
                          key={ctrl.id}
                          className="flex items-center justify-between rounded-lg border border-slate-700 p-3 hover:border-slate-600"
                        >
                          <div className="flex items-center gap-3">
                            <XCircle className="h-4 w-4 text-red-400" />
                            <div>
                              <p className="text-sm font-medium text-white">{ctrl.code}</p>
                              <p className="text-xs text-slate-400 truncate max-w-md">{ctrl.name}</p>
                            </div>
                          </div>
                          <button className="btn-ghost btn-sm flex items-center gap-1 text-primary-400">
                            <Plus className="h-3 w-3" />
                            Add Evidence
                          </button>
                        </div>
                      ))}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <CheckCircle className="mb-3 h-10 w-10 text-green-400" />
                  <p className="text-slate-300">All controls in this category have evidence!</p>
                </div>
              )}
            </div>
            <div className="border-t border-slate-700 p-4 flex justify-end gap-3">
              <button onClick={closeModal} className="btn-ghost">
                Close
              </button>
              <button className="btn-primary flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Add Evidence
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
