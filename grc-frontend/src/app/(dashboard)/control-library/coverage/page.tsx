'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import {
  Shield,
  CheckCircle,
  Download,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  FileText,
  AlertTriangle,
  Layers,
  TrendingUp,
  BarChart3,
  ArrowLeft,
} from 'lucide-react';
import Link from 'next/link';
import { ProgressRing } from '@/components/ui';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
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

function dedupeCoverageFrameworks<T extends { framework_id: number; framework_name: string; framework_code: string; total_controls: number }>(frameworks: T[]) {
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

function compactFrameworkLabel(value?: string, max = 24) {
  if (!value) return 'Unknown';
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export default function CoverageMatrixPage() {
  const [expandedFramework, setExpandedFramework] = useState<number | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showAllBars, setShowAllBars] = useState(false);

  const BAR_PREVIEW_COUNT = 5;

  const { data: matrixData, isLoading: matrixLoading, error: matrixError } = useQuery({
    queryKey: ['coverage-matrix'],
    queryFn: async () => {
      const response = await apiClient.get('/control-library/coverage/matrix');
      return response.data as CoverageMatrix;
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const { data: auditSavings } = useQuery({
    queryKey: ['audit-savings'],
    queryFn: async () => {
      const response = await apiClient.get('/control-library/coverage/audit-savings');
      return response.data as AuditSavings;
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const dedupedFrameworks = useMemo(() => {
    return dedupeCoverageFrameworks(matrixData?.frameworks || []);
  }, [matrixData]);

  const summaryStats = useMemo(() => {
    if (!dedupedFrameworks.length) return null;

    const totalControls = dedupedFrameworks.reduce((sum, fw) => sum + fw.total_controls, 0);
    const coveredControls = dedupedFrameworks.reduce((sum, fw) => sum + fw.covered_controls, 0);
    const overallCoverage = totalControls > 0 ? Math.round((coveredControls / totalControls) * 100) : 0;
    const fullyCompliantFrameworks = dedupedFrameworks.filter(fw => fw.coverage_percent === 100).length;
    
    const categoriesWithGaps = new Set<string>();
    dedupedFrameworks.forEach(fw => {
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
  }, [dedupedFrameworks, auditSavings]);

  const byFrameworkData = useMemo<{ frameworks: FrameworkCoverage[] }>(() => {
    if (!dedupedFrameworks.length) return { frameworks: [] };

    return {
      frameworks: dedupedFrameworks.map((fw) => ({
        framework_id: fw.framework_id,
        framework_name: fw.framework_name,
        framework_code: fw.framework_code,
        total_controls: fw.total_controls,
        covered_controls: fw.covered_controls,
        coverage_percent: fw.coverage_percent,
        by_category: Object.entries(fw.categories || {}).map(([category_name, cat]) => ({
          category_name,
          total_controls: cat.controls_total,
          covered_controls: cat.controls_with_evidence,
          coverage_percent: cat.coverage_percent,
        })),
      })),
    };
  }, [dedupedFrameworks]);

  const chartData = useMemo(() => {
    if (!byFrameworkData.frameworks.length) return [];
    return byFrameworkData.frameworks.map(fw => ({
      name: fw.framework_name,
      fullName: fw.framework_name,
      covered: fw.covered_controls,
      uncovered: fw.total_controls - fw.covered_controls,
      coverage: fw.coverage_percent,
      total: fw.total_controls,
    }));
  }, [byFrameworkData]);

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

  const getCoverageHex = (percentage: number) => {
    if (percentage <= 33) return COLORS.red;
    if (percentage <= 66) return COLORS.yellow;
    return COLORS.green;
  };

  const isLoading = matrixLoading;

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

  if (matrixError) {
    return (
      <div className="card p-8 text-center">
        <AlertCircle className="mx-auto h-10 w-10 text-red-500 mb-3" />
        <h3 className="text-lg font-medium text-slate-900">Failed to load coverage data</h3>
        <p className="text-sm text-gray-600 mt-1">
          {(matrixError as Error)?.message || 'An unexpected error occurred while fetching the coverage matrix.'}
        </p>
      </div>
    );
  }

  if (!dedupedFrameworks.length) {
    return (
      <div className="card p-8 text-center">
        <BarChart3 className="mx-auto h-10 w-10 text-gray-400 mb-3" />
        <h3 className="text-lg font-medium text-slate-900">No coverage data yet</h3>
        <p className="text-sm text-gray-600 mt-1">
          Add frameworks and link evidence to controls to populate the coverage matrix.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link href="/control-library" className="text-gray-500 hover:text-black flex-shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-black sm:text-2xl">Compliance Coverage Matrix</h1>
            <p className="text-sm text-gray-600">Evidence coverage across frameworks and categories</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
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
              <div className="absolute right-0 top-full z-10 mt-2 w-40 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                <button
                  onClick={() => exportMutation.mutate()}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                >
                  <FileText className="h-4 w-4" />
                  Export as CSV
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {[
          {
            label: 'Overall Coverage',
            value: `${summaryStats?.overallCoverage || 0}%`,
            sub: `${summaryStats?.coveredControls || 0} / ${summaryStats?.totalControls || 0} controls`,
            Icon: TrendingUp,
            tone: summaryStats && summaryStats.overallCoverage >= 67 ? 'green' : summaryStats && summaryStats.overallCoverage >= 34 ? 'yellow' : 'red',
          },
          {
            label: 'Fully Covered',
            value: summaryStats?.fullyCompliantFrameworks || 0,
            sub: 'Frameworks at 100%',
            Icon: CheckCircle,
            tone: 'green' as const,
          },
          {
            label: 'Categories with Gaps',
            value: summaryStats?.categoriesWithGaps || 0,
            sub: 'Need attention',
            Icon: AlertTriangle,
            tone: 'yellow' as const,
          },
          {
            label: 'Evidence Items',
            value: summaryStats?.totalEvidence || 0,
            sub: 'Total uploaded',
            Icon: FileText,
            tone: 'blue' as const,
          },
        ].map(({ label, value, sub, Icon, tone }) => {
          const toneClasses: Record<string, string> = {
            green: 'text-green-600',
            yellow: 'text-yellow-600',
            red: 'text-red-600',
            blue: 'text-blue-600',
          };
          return (
            <div key={label} className="rounded-lg border border-gray-200 bg-white p-2.5 flex items-center gap-2.5">
              <Icon className={`h-4 w-4 flex-shrink-0 ${toneClasses[tone] || toneClasses.blue}`} />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500 truncate">{label}</p>
                <p className="text-base font-semibold text-black leading-tight">{value}</p>
                <p className="text-[10px] text-gray-500 truncate">{sub}</p>
              </div>
            </div>
          );
        })}
        <div className="rounded-lg border border-gray-200 bg-white p-2 flex items-center justify-center">
          <ProgressRing
            percentage={summaryStats?.overallCoverage || 0}
            size={56}
            strokeWidth={5}
            color={summaryStats && summaryStats.overallCoverage >= 67 ? 'success' : summaryStats && summaryStats.overallCoverage >= 34 ? 'warning' : 'danger'}
            label="Coverage"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card">
            <div className="card-header flex flex-row items-center justify-between gap-2">
              <h2 className="card-title flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-blue-400" />
                Framework Coverage Comparison
              </h2>
              {chartData.length > BAR_PREVIEW_COUNT && (
                <button
                  onClick={() => setShowAllBars((v) => !v)}
                  className="text-xs font-medium text-primary-600 hover:text-primary-700"
                >
                  {showAllBars ? 'Show less' : `…more (${chartData.length - BAR_PREVIEW_COUNT})`}
                </button>
              )}
            </div>
            {chartData.length > 0 ? (
              (() => {
                const visibleBars = showAllBars ? chartData : chartData.slice(0, BAR_PREVIEW_COUNT);
                const dynamicHeight = Math.max(220, visibleBars.length * 36 + 40);
                return (
                  <div className="p-4" style={{ height: showAllBars ? dynamicHeight : 320 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={visibleBars} layout="vertical" margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                        <XAxis type="number" domain={[0, 100]} tick={{ fill: '#6b7280', fontSize: 10 }} />
                        <YAxis dataKey="name" type="category" tick={{ fill: '#374151', fontSize: 10 }} width={120} tickFormatter={(value) => compactFrameworkLabel(String(value), 16)} />
                        <Tooltip
                          cursor={{ fill: 'rgba(59, 130, 246, 0.06)' }}
                          contentStyle={{
                            backgroundColor: '#ffffff',
                            border: '1px solid #e5e7eb',
                            borderRadius: '6px',
                            color: '#111827',
                            fontSize: '11px',
                            padding: '4px 8px',
                            boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
                          }}
                          itemStyle={{ fontSize: '11px', padding: 0, color: '#111827' }}
                          labelStyle={{ fontSize: '10px', color: '#6b7280', marginBottom: 2 }}
                          formatter={(value, name) => {
                            const numericValue =
                              typeof value === 'number' ? value : Number(value ?? 0);
                            return [
                              name === 'coverage' ? `${numericValue}%` : numericValue,
                              name === 'coverage' ? 'Coverage' : String(name),
                            ];
                          }}
                        />
                        <Bar dataKey="coverage" radius={[0, 4, 4, 0]}>
                          {visibleBars.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={getCoverageHex(entry.coverage)} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                );
              })()
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <BarChart3 className="mb-4 h-12 w-12 text-gray-400" />
                <p className="text-gray-600">No framework data available</p>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-header">
              <h2 className="card-title flex items-center gap-2">
                <Layers className="h-5 w-5 text-purple-400" />
                Coverage Distribution
              </h2>
            </div>
            {chartData.length > 0 ? (
              <div className="h-80 px-2 pb-2">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart cx="50%" cy="50%" outerRadius="68%" data={chartData}>
                    <PolarGrid stroke="#e5e7eb" gridType="circle" />
                    <PolarAngleAxis
                      dataKey="name"
                      tick={(props: any) => {
                        // Place labels radially relative to the centre so the
                        // ticks at top / bottom / sides don't clip into the
                        // radar polygon or the card edge. We compute the
                        // angle from the tick's (x, y) and the chart centre,
                        // then push the text outward and align it based on
                        // which quadrant it sits in.
                        const { x, y, cx, cy, payload } = props;
                        const dx = x - cx;
                        const dy = y - cy;
                        const len = Math.hypot(dx, dy) || 1;
                        const offset = 6;
                        const tx = x + (dx / len) * offset;
                        const ty = y + (dy / len) * offset;
                        const cos = dx / len;
                        const sin = dy / len;
                        let textAnchor: 'start' | 'middle' | 'end' = 'middle';
                        if (cos > 0.25) textAnchor = 'start';
                        else if (cos < -0.25) textAnchor = 'end';
                        let baseline: 'middle' | 'hanging' | 'auto' = 'middle';
                        if (sin > 0.4) baseline = 'hanging';
                        else if (sin < -0.4) baseline = 'auto';
                        return (
                          <text
                            x={tx}
                            y={ty}
                            textAnchor={textAnchor}
                            dominantBaseline={baseline}
                            fill="#374151"
                            fontSize={9}
                          >
                            {compactFrameworkLabel(String(payload?.value ?? ''), 12)}
                          </text>
                        );
                      }}
                    />
                    <PolarRadiusAxis
                      angle={90}
                      domain={[0, 100]}
                      tick={{ fill: '#9ca3af', fontSize: 8 }}
                      stroke="#e5e7eb"
                      tickCount={4}
                    />
                    <Radar
                      name="Coverage"
                      dataKey="coverage"
                      stroke="transparent"
                      fill="#3b82f6"
                      fillOpacity={0.08}
                      strokeWidth={0}
                      isAnimationActive={false}
                      shape={(props: any): any => {
                        // Per-segment coloring: each edge of the polygon is
                        // tinted by the average coverage of its two endpoints
                        // (red < 34, yellow < 67, green ≥ 67). The fill stays
                        // a soft neutral blue so the multi-coloured edges
                        // are the visual focus.
                        const { points, baseLinePoints } = props;
                        if (!points || points.length === 0) return <g />;
                        const polyPath = points
                          .map((p: any, i: number) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`)
                          .join(' ') + ' Z';
                        const segments = points.map((p: any, i: number) => {
                          const next = points[(i + 1) % points.length];
                          const v1 = Number(p.payload?.coverage ?? p.value ?? 0);
                          const v2 = Number(next.payload?.coverage ?? next.value ?? 0);
                          const color = getCoverageHex((v1 + v2) / 2);
                          return (
                            <line
                              key={`seg-${i}`}
                              x1={p.x}
                              y1={p.y}
                              x2={next.x}
                              y2={next.y}
                              stroke={color}
                              strokeWidth={1.75}
                              strokeLinecap="round"
                            />
                          );
                        });
                        // baseLinePoints is unused but referenced to satisfy
                        // recharts' inferred shape signature.
                        void baseLinePoints;
                        return (
                          <g>
                            <path d={polyPath} fill="#3b82f6" fillOpacity={0.08} stroke="none" />
                            {segments}
                          </g>
                        );
                      }}
                      dot={(props: any) => {
                        const { cx, cy, payload } = props;
                        const color = getCoverageHex(payload?.coverage ?? 0);
                        return (
                          <circle
                            cx={cx}
                            cy={cy}
                            r={3}
                            fill={color}
                            stroke="#ffffff"
                            strokeWidth={1}
                          />
                        );
                      }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#ffffff',
                        border: '1px solid #e5e7eb',
                        borderRadius: '6px',
                        color: '#111827',
                        fontSize: '11px',
                        padding: '4px 8px',
                        boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
                      }}
                      itemStyle={{ fontSize: '11px', padding: 0, color: '#111827' }}
                      labelStyle={{ fontSize: '10px', color: '#6b7280', marginBottom: 2 }}
                      formatter={(value: any) => [`${value}%`, 'Coverage']}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Layers className="mb-4 h-12 w-12 text-gray-400" />
                <p className="text-gray-600">No coverage data available</p>
              </div>
            )}
          </div>
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
              <div key={fw.framework_id} className="rounded-lg border border-gray-200 overflow-hidden">
                <button
                  onClick={() => setExpandedFramework(expandedFramework === fw.framework_id ? null : fw.framework_id)}
                  className="w-full flex items-center justify-between p-4 hover:bg-gray-100 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
                      <Shield className="h-5 w-5 text-gray-600" />
                    </div>
                    <div className="text-left">
                      <p className="font-medium text-black">{fw.framework_code}</p>
                      <p className="text-xs text-gray-600">{fw.framework_name}</p>
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
                      <p className="text-xs text-gray-600">
                        {fw.covered_controls} / {fw.total_controls} controls
                      </p>
                    </div>
                    {expandedFramework === fw.framework_id ? (
                      <ChevronDown className="h-5 w-5 text-gray-600" />
                    ) : (
                      <ChevronRight className="h-5 w-5 text-gray-600" />
                    )}
                  </div>
                </button>
                {expandedFramework === fw.framework_id && (
                  <div className="border-t border-gray-200 p-4 bg-gray-50">
                    <h4 className="text-sm font-medium text-gray-700 mb-3">Coverage by Category</h4>
                    <div className="space-y-2">
                      {fw.by_category.map((cat, idx) => (
                        <div key={idx} className="flex items-center gap-3">
                          <span className="text-sm text-gray-600 w-40 truncate" title={cat.category_name}>
                            {cat.category_name}
                          </span>
                          <div className="flex-1 h-2 overflow-hidden rounded-full bg-gray-100">
                            <div
                              className={`h-full transition-all ${getCoverageColor(cat.coverage_percent)}`}
                              style={{ width: `${cat.coverage_percent}%` }}
                            />
                          </div>
                          <span className={`text-sm font-medium w-16 text-right ${getCoverageTextColor(cat.coverage_percent)}`}>
                            {cat.coverage_percent}%
                          </span>
                          <span className="text-xs text-gray-500 w-20 text-right">
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

    </div>
  );
}
