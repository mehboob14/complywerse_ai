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
  Filter,
  RefreshCw,
} from 'lucide-react';
import { StatCard, ProgressRing, SeverityBadge } from '@/components/ui';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
  Legend,
} from 'recharts';

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

const COLORS = {
  red: '#ef4444',
  yellow: '#f59e0b',
  green: '#22c55e',
  blue: '#3b82f6',
  purple: '#a855f7',
  cyan: '#06b6d4',
};

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
  const [selectedFrameworkIds, setSelectedFrameworkIds] = useState<number[]>([]);
  const [viewMode, setViewMode] = useState<'heatmap' | 'chart'>('heatmap');

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
      totalControls,
      coveredControls,
    };
  }, [matrixData, auditSavings]);

  const filteredHeatmapData = useMemo(() => {
    if (!heatmapData) return null;
    if (selectedFrameworkIds.length === 0) return heatmapData;
    
    const filteredRows: typeof heatmapData.rows = [];
    const filteredValues: typeof heatmapData.values = [];
    
    heatmapData.rows.forEach((row, idx) => {
      if (selectedFrameworkIds.includes(row.id)) {
        filteredRows.push(row);
        filteredValues.push(heatmapData.values[idx]);
      }
    });
    
    return {
      ...heatmapData,
      rows: filteredRows,
      values: filteredValues,
    };
  }, [heatmapData, selectedFrameworkIds]);

  const chartData = useMemo(() => {
    if (!byFrameworkData?.frameworks) return [];
    return byFrameworkData.frameworks.map(fw => ({
      name: fw.framework_code,
      fullName: fw.framework_name,
      covered: fw.covered_controls,
      uncovered: fw.total_controls - fw.covered_controls,
      coverage: fw.coverage_percent,
      total: fw.total_controls,
    }));
  }, [byFrameworkData]);

  const coverageDistribution = useMemo(() => {
    if (!matrixData?.frameworks) return [];
    const high = matrixData.frameworks.filter(fw => fw.coverage_percent >= 67).length;
    const medium = matrixData.frameworks.filter(fw => fw.coverage_percent >= 34 && fw.coverage_percent < 67).length;
    const low = matrixData.frameworks.filter(fw => fw.coverage_percent < 34).length;
    return [
      { name: 'High (67-100%)', value: high, color: COLORS.green },
      { name: 'Medium (34-66%)', value: medium, color: COLORS.yellow },
      { name: 'Low (0-33%)', value: low, color: COLORS.red },
    ].filter(d => d.value > 0);
  }, [matrixData]);

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

  const getCoverageHex = (percentage: number) => {
    if (percentage <= 33) return COLORS.red;
    if (percentage <= 66) return COLORS.yellow;
    return COLORS.green;
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

  const toggleFrameworkFilter = (id: number) => {
    setSelectedFrameworkIds(prev => 
      prev.includes(id) ? prev.filter(fid => fid !== id) : [...prev, id]
    );
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
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Compliance Coverage Matrix</h1>
          <p className="text-slate-400">Evidence coverage across frameworks and categories</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border border-slate-200 overflow-hidden">
            <button
              onClick={() => setViewMode('heatmap')}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                viewMode === 'heatmap' 
                  ? 'bg-primary-600 text-white' 
                  : 'bg-white text-slate-400 hover:text-slate-900'
              }`}
            >
              <Grid3X3 className="h-4 w-4 inline mr-1" />
              Heatmap
            </button>
            <button
              onClick={() => setViewMode('chart')}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                viewMode === 'chart' 
                  ? 'bg-primary-600 text-white' 
                  : 'bg-white text-slate-400 hover:text-slate-900'
              }`}
            >
              <BarChart3 className="h-4 w-4 inline mr-1" />
              Charts
            </button>
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
              Export
            </button>
            {showExportMenu && (
              <div className="absolute right-0 top-full z-10 mt-2 w-40 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                <button
                  onClick={() => exportMutation.mutate()}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-slate-600 hover:bg-slate-200"
                >
                  <FileText className="h-4 w-4" />
                  Export as CSV
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          title="Overall Coverage"
          value={`${summaryStats?.overallCoverage || 0}%`}
          icon={TrendingUp}
          variant={summaryStats && summaryStats.overallCoverage >= 67 ? 'success' : summaryStats && summaryStats.overallCoverage >= 34 ? 'warning' : 'danger'}
          subtitle={`${summaryStats?.coveredControls || 0} of ${summaryStats?.totalControls || 0} controls`}
        />
        <StatCard
          title="Fully Covered"
          value={summaryStats?.fullyCompliantFrameworks || 0}
          icon={CheckCircle}
          variant="success"
          subtitle="Frameworks at 100%"
        />
        <StatCard
          title="Categories with Gaps"
          value={summaryStats?.categoriesWithGaps || 0}
          icon={AlertTriangle}
          variant="warning"
          subtitle="Requiring attention"
        />
        <StatCard
          title="Evidence Items"
          value={summaryStats?.totalEvidence || 0}
          icon={FileText}
          variant="info"
          subtitle="Total uploaded"
        />
        <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-center justify-center">
          <ProgressRing
            percentage={summaryStats?.overallCoverage || 0}
            size={80}
            color={summaryStats && summaryStats.overallCoverage >= 67 ? 'success' : summaryStats && summaryStats.overallCoverage >= 34 ? 'warning' : 'danger'}
            label="Coverage"
          />
        </div>
      </div>

      {heatmapData?.rows && heatmapData.rows.length > 0 && (
        <div className="card">
          <div className="card-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="card-title flex items-center gap-2">
                <Filter className="h-5 w-5 text-primary-400" />
                Framework Filters
              </h2>
              <p className="card-description">Select frameworks to filter the heatmap view</p>
            </div>
            {selectedFrameworkIds.length > 0 && (
              <button
                onClick={() => setSelectedFrameworkIds([])}
                className="btn-ghost text-sm flex items-center gap-1"
              >
                <RefreshCw className="h-3 w-3" />
                Clear Filters
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2 p-4 pt-0">
            {heatmapData.rows.map(row => (
              <button
                key={row.id}
                onClick={() => toggleFrameworkFilter(row.id)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
                  selectedFrameworkIds.length === 0 || selectedFrameworkIds.includes(row.id)
                    ? 'bg-primary-600 text-white'
                    : 'bg-slate-200 text-slate-500 hover:bg-slate-600'
                }`}
              >
                {row.code}
              </button>
            ))}
          </div>
        </div>
      )}

      {viewMode === 'chart' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card">
            <div className="card-header">
              <h2 className="card-title flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-blue-400" />
                Framework Coverage Comparison
              </h2>
            </div>
            {chartData.length > 0 ? (
              <div className="h-80 p-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical">
                    <XAxis type="number" domain={[0, 100]} tick={{ fill: '#94a3b8' }} />
                    <YAxis dataKey="name" type="category" tick={{ fill: '#94a3b8' }} width={80} />
                    <Tooltip
                      contentStyle={{ 
                        backgroundColor: '#1e293b', 
                        border: '1px solid #334155',
                        borderRadius: '8px',
                        color: '#fff'
                      }}
                      formatter={(value: number, name: string) => [
                        name === 'coverage' ? `${value}%` : value,
                        name === 'coverage' ? 'Coverage' : name
                      ]}
                    />
                    <Bar dataKey="coverage" radius={[0, 4, 4, 0]}>
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={getCoverageHex(entry.coverage)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <BarChart3 className="mb-4 h-12 w-12 text-slate-600" />
                <p className="text-slate-400">No framework data available</p>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-header">
              <h2 className="card-title flex items-center gap-2">
                <Layers className="h-5 w-5 text-primary-600" />
                Coverage Distribution
              </h2>
            </div>
            {coverageDistribution.length > 0 ? (
              <div className="h-80 p-4">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={coverageDistribution}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={2}
                      dataKey="value"
                      label={({ name, value }) => `${name}: ${value}`}
                      labelLine={{ stroke: '#64748b' }}
                    >
                      {coverageDistribution.map((entry, index) => (
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
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Layers className="mb-4 h-12 w-12 text-slate-600" />
                <p className="text-slate-400">No coverage data available</p>
              </div>
            )}
          </div>
        </div>
      ) : (
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

          {!filteredHeatmapData?.rows?.length ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <BarChart3 className="mb-4 h-12 w-12 text-slate-600" />
              <h3 className="text-lg font-medium text-slate-800">No coverage data available</h3>
              <p className="mt-1 text-slate-400">Add frameworks and evidence to see the coverage matrix</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <div className="min-w-max">
                  <div
                    className="grid gap-1"
                    style={{
                      gridTemplateColumns: `200px repeat(${filteredHeatmapData.columns.length}, minmax(80px, 1fr))`,
                    }}
                  >
                    <div className="p-2 text-xs font-medium uppercase text-slate-400"></div>
                    {filteredHeatmapData.columns.map((col, colIdx) => (
                      <div
                        key={colIdx}
                        className="p-2 text-center text-xs font-medium uppercase text-slate-400 truncate"
                        title={col}
                      >
                        {col.length > 15 ? col.substring(0, 15) + '...' : col}
                      </div>
                    ))}

                    {filteredHeatmapData.rows.map((row, rowIdx) => (
                      <>
                        <div key={`row-${rowIdx}`} className="flex items-center gap-2 p-2">
                          <Shield className="h-4 w-4 text-slate-400" />
                          <div className="truncate">
                            <span className="font-medium text-slate-800 text-sm">{row.code}</span>
                          </div>
                        </div>
                        {filteredHeatmapData.values[rowIdx]?.map((cell, colIdx) => (
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
                                  filteredHeatmapData.columns[colIdx],
                                  cell.value,
                                  cell.controls_total,
                                  cell.controls_with_evidence
                                )
                              }
                              className={`w-full h-12 rounded flex items-center justify-center transition-all hover:ring-2 hover:ring-primary-500 ${getCoverageColor(cell.value)}`}
                            >
                              <span className="text-xs font-bold text-slate-800 drop-shadow-md">
                                {cell.value}%
                              </span>
                            </button>
                            {hoveredCell?.row === rowIdx && hoveredCell?.col === colIdx && (
                              <div className="absolute bottom-full left-1/2 z-20 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-50 px-3 py-2 text-xs shadow-lg border border-slate-200">
                                <p className="font-medium text-slate-800">{row.code} × {filteredHeatmapData.columns[colIdx]}</p>
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

              <div className="mt-6 flex items-center justify-center gap-6 border-t border-slate-200 pt-4">
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
      )}

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
              <div key={fw.framework_id} className="rounded-lg border border-slate-200 overflow-hidden">
                <button
                  onClick={() => setExpandedFramework(expandedFramework === fw.framework_id ? null : fw.framework_id)}
                  className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-200">
                      <Shield className="h-5 w-5 text-slate-400" />
                    </div>
                    <div className="text-left">
                      <p className="font-medium text-slate-800">{fw.framework_code}</p>
                      <p className="text-xs text-slate-400">{fw.framework_name}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <ProgressRing
                      percentage={fw.coverage_percent}
                      size={48}
                      strokeWidth={4}
                      color={fw.coverage_percent >= 67 ? 'success' : fw.coverage_percent >= 34 ? 'warning' : 'danger'}
                    />
                    <div className="text-right">
                      <p className="text-xs text-slate-400">
                        {fw.covered_controls} / {fw.total_controls} controls
                      </p>
                    </div>
                    {expandedFramework === fw.framework_id ? (
                      <ChevronDown className="h-5 w-5 text-slate-400" />
                    ) : (
                      <ChevronRight className="h-5 w-5 text-slate-400" />
                    )}
                  </div>
                </button>
                {expandedFramework === fw.framework_id && (
                  <div className="border-t border-slate-200 p-4 bg-white/50">
                    <h4 className="text-sm font-medium text-slate-600 mb-3">Coverage by Category</h4>
                    <div className="space-y-2">
                      {fw.by_category.map((cat, idx) => (
                        <div key={idx} className="flex items-center gap-3">
                          <span className="text-sm text-slate-400 w-40 truncate" title={cat.category_name}>
                            {cat.category_name}
                          </span>
                          <div className="flex-1 h-2 overflow-hidden rounded-full bg-slate-200">
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

      {selectedCell && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl max-h-[80vh] overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 p-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-800">
                  {selectedCell.frameworkCode} × {selectedCell.category}
                </h3>
                <p className="text-sm text-slate-400">Coverage Details</p>
              </div>
              <button
                onClick={closeModal}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[60vh]">
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="rounded-lg bg-white p-4 text-center">
                  <ProgressRing
                    percentage={selectedCell.coverage}
                    size={60}
                    color={selectedCell.coverage >= 67 ? 'success' : selectedCell.coverage >= 34 ? 'warning' : 'danger'}
                  />
                  <p className="text-xs text-slate-400 mt-2">Coverage</p>
                </div>
                <div className="rounded-lg bg-white p-4 text-center">
                  <p className="text-2xl font-bold text-green-400">{selectedCell.controlsWithEvidence}</p>
                  <p className="text-xs text-slate-400">With Evidence</p>
                </div>
                <div className="rounded-lg bg-white p-4 text-center">
                  <p className="text-2xl font-bold text-red-400">
                    {selectedCell.controlsTotal - selectedCell.controlsWithEvidence}
                  </p>
                  <p className="text-xs text-slate-400">Missing Evidence</p>
                </div>
              </div>

              <div className="mb-4">
                <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200">
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
                  <h4 className="text-sm font-medium text-slate-600 mb-3">
                    Uncovered Controls ({frameworkDetail.uncovered_control_list.length})
                  </h4>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {frameworkDetail.uncovered_control_list
                      .filter(ctrl => ctrl.domain === selectedCell.category || !selectedCell.category)
                      .slice(0, 20)
                      .map((ctrl) => (
                        <div
                          key={ctrl.id}
                          className="flex items-center justify-between rounded-lg border border-slate-200 p-3 hover:border-slate-300"
                        >
                          <div className="flex items-center gap-3">
                            <XCircle className="h-4 w-4 text-red-400" />
                            <div>
                              <p className="text-sm font-medium text-slate-800">{ctrl.code}</p>
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
                  <p className="text-slate-600">All controls in this category have evidence!</p>
                </div>
              )}
            </div>
            <div className="border-t border-slate-200 p-4 flex justify-end gap-3">
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
