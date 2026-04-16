'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ermApi } from '@/lib/api';
import { StatCard, ProgressRing } from '@/components/ui';
import {
  AlertTriangle,
  Activity,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Shield,
  ArrowRight,
  Clock,
  CheckCircle,
  BarChart3,
  Target,
  Users,
  Calendar,
  AlertOctagon,
  ChevronRight,
  Minus,
  ArrowUp,
  ArrowDown,
  Gauge,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
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
} from 'recharts';

const CATEGORY_COLORS: Record<string, string> = {
  strategic: 'var(--color-base)',
  operational: 'var(--color-base)',
  financial: 'var(--color-success)',
  compliance: 'var(--color-warning)',
  technology: 'var(--color-base)',
  reputational: 'var(--color-danger)',
  third_party: 'var(--color-warning)',
};

const CATEGORY_LABELS: Record<string, string> = {
  strategic: 'Strategic',
  operational: 'Operational',
  financial: 'Financial',
  compliance: 'Compliance',
  technology: 'Technology',
  reputational: 'Reputational',
  third_party: 'Third-party',
};

const TREATMENT_COLORS: Record<string, string> = {
  mitigate: 'var(--color-base)',
  accept: 'var(--color-success)',
  transfer: 'var(--color-warning)',
  avoid: 'var(--color-danger)',
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'var(--color-danger)',
  high: 'var(--color-warning)',
  medium: 'var(--color-warning)',
  low: 'var(--color-success)',
};

const tooltipStyle = {
  backgroundColor: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: '8px',
  color: 'var(--color-text)',
};

const LIKELIHOOD_LABELS = ['Rare', 'Unlikely', 'Possible', 'Likely', 'Almost Certain'];
const IMPACT_LABELS = ['Insignificant', 'Minor', 'Moderate', 'Major', 'Catastrophic'];

function getHeatmapColor(likelihood: number, impact: number): string {
  const score = likelihood * impact;
  if (score >= 20) return 'bg-[var(--color-danger)] hover:bg-[var(--color-danger)]/80';
  if (score >= 15) return 'bg-[var(--color-warning)] hover:bg-[var(--color-warning)]/80';
  if (score >= 10) return 'bg-[var(--color-warning)] hover:bg-[var(--color-warning)]/70';
  if (score >= 5) return 'bg-[var(--color-base)] hover:bg-[var(--color-base)]/80';
  return 'bg-[var(--color-success)] hover:bg-[var(--color-success)]/80';
}

function getHeatmapBorderColor(likelihood: number, impact: number): string {
  const score = likelihood * impact;
  if (score >= 20) return 'border-[var(--color-danger)]';
  if (score >= 15) return 'border-[var(--color-warning)]';
  if (score >= 10) return 'border-[var(--color-warning)]';
  if (score >= 5) return 'border-[var(--color-base)]';
  return 'border-[var(--color-success)]';
}

interface HeatmapCellData {
  count: number;
  risks: Array<{ id: number; title: string; score: number }>;
}

function RiskSpeedometer({
  score,
  signals,
}: {
  score: number;
  signals: Array<{ label: string; value: string; tone?: string }>;
}) {
  const safeScore = Math.max(0, Math.min(100, score));
  const gaugeColor = safeScore >= 75 ? '#10b981' : safeScore >= 55 ? '#f59e0b' : '#ef4444';
  const data = [
    { name: 'score', value: safeScore, fill: gaugeColor },
    { name: 'remaining', value: 100 - safeScore, fill: '#e5e7eb' },
  ];

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h2 className="card-title">Risk Pulse Speedometer</h2>
          <p className="card-description">Blended view of exposure, KRIs, and response capacity</p>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[220px_1fr] lg:items-center">
        <div className="relative mx-auto h-[190px] w-full max-w-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="78%"
                startAngle={180}
                endAngle={0}
                innerRadius={56}
                outerRadius={80}
                dataKey="value"
                stroke="none"
              >
                {data.map((entry, idx) => (
                  <Cell key={idx} fill={entry.fill} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pt-7">
            <span className="text-3xl font-semibold" style={{ color: gaugeColor }}>{safeScore}%</span>
            <span className="mt-1 text-xs text-slate-500">overall posture</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
          {signals.map((signal) => (
            <div key={signal.label} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{signal.label}</p>
              <p className={`mt-1 text-sm font-semibold ${signal.tone || 'text-slate-900'}`}>{signal.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ExposureLollipop({
  items,
  maxValue = 25,
  suffix = '',
}: {
  items: Array<{ label: string; value: number; color: string; meta?: string }>;
  maxValue?: number;
  suffix?: string;
}) {
  if (!items.length) {
    return <div className="flex h-[220px] items-center justify-center text-xs text-slate-500">No data available</div>;
  }

  return (
    <div className="space-y-4">
      {items.map((item) => {
        const width = Math.max(6, (item.value / Math.max(1, maxValue)) * 100);
        return (
          <div key={item.label}>
            <div className="mb-1 flex items-center justify-between gap-3 text-xs">
              <span className="font-medium text-slate-700">{item.label}</span>
              <span className="text-slate-500">
                <span className="font-semibold text-slate-900">{item.value}{suffix}</span>
                {item.meta ? <span className="ml-1">• {item.meta}</span> : null}
              </span>
            </div>
            <div className="relative h-2 rounded-full bg-slate-100">
              <div className="absolute left-0 top-1/2 h-2 -translate-y-1/2 rounded-full" style={{ width: `${width}%`, backgroundColor: item.color }} />
              <span
                className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-white shadow-sm"
                style={{ left: `calc(${width}% - 8px)`, backgroundColor: item.color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ResidualDotPlot({
  data,
}: {
  data: Array<{ category: string; inherent: number; residual: number }>;
}) {
  if (!data.length) {
    return <div className="flex h-[220px] items-center justify-center text-xs text-slate-500">No score data yet</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" />Inherent</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-600" />Residual</span>
      </div>
      {data.map((item) => (
        <div key={item.category}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-medium text-slate-700">{item.category}</span>
            <span className="text-slate-500">{item.residual} / {item.inherent}</span>
          </div>
          <div className="relative h-3 rounded-full bg-slate-100">
            <span className="absolute inset-y-0 left-0 right-0 rounded-full border border-dashed border-slate-200" />
            <span className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-white bg-amber-500 shadow-sm" style={{ left: `calc(${(item.inherent / 25) * 100}% - 7px)` }} />
            <span className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-white bg-blue-600 shadow-sm" style={{ left: `calc(${(item.residual / 25) * 100}% - 7px)` }} />
          </div>
        </div>
      ))}
      <div className="flex justify-between text-[10px] text-slate-400">
        <span>0</span>
        <span>5</span>
        <span>10</span>
        <span>15</span>
        <span>20</span>
        <span>25</span>
      </div>
    </div>
  );
}

function RiskSunburst({
  rings,
  centerValue,
  centerLabel,
}: {
  rings: Array<{ label: string; items: Array<{ name: string; value: number; color: string }> }>;
  centerValue: string;
  centerLabel: string;
}) {
  const radii = [
    { inner: 30, outer: 48 },
    { inner: 54, outer: 72 },
    { inner: 78, outer: 96 },
  ];

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h2 className="card-title">Risk Universe Sunburst</h2>
          <p className="card-description">Exposure layers across score, treatment, and signal status</p>
        </div>
      </div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="relative mx-auto h-[240px] w-[240px] flex-shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              {rings.map((ring, ringIndex) => {
                const data = ring.items.filter((item) => item.value > 0);
                const chartData = data.length ? data : [{ name: 'None', value: 1, color: '#e2e8f0' }];
                return (
                  <Pie
                    key={ring.label}
                    data={chartData}
                    dataKey="value"
                    cx="50%"
                    cy="50%"
                    innerRadius={radii[ringIndex]?.inner || 30}
                    outerRadius={radii[ringIndex]?.outer || 48}
                    paddingAngle={2}
                    stroke="white"
                    strokeWidth={2}
                  >
                    {chartData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.color} />
                    ))}
                  </Pie>
                );
              })}
              <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-2xl font-semibold text-slate-900">{centerValue}</span>
            <span className="text-xs text-slate-500">{centerLabel}</span>
          </div>
        </div>
        <div className="flex-1 space-y-3">
          {rings.map((ring) => (
            <div key={ring.label} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{ring.label}</p>
              <div className="space-y-1.5">
                {ring.items.filter((item) => item.value > 0).map((item) => (
                  <div key={item.name} className="flex items-center gap-2 text-xs">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="flex-1 text-slate-600">{item.name}</span>
                    <span className="font-semibold text-slate-900">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RiskBowTie({
  leftNodes,
  rightNodes,
  centerValue,
  centerLabel,
}: {
  leftNodes: Array<{ label: string; value: number; hint: string; tone: string }>;
  rightNodes: Array<{ label: string; value: number; hint: string; tone: string }>;
  centerValue: string;
  centerLabel: string;
}) {
  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h2 className="card-title">Exposure vs Response Bow-Tie</h2>
          <p className="card-description">Incoming risk pressure against treatment and mitigation capacity</p>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_170px_1fr] lg:items-center">
        <div className="space-y-3">
          {leftNodes.map((node) => (
            <div key={node.label} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 lg:mr-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-slate-700">{node.label}</p>
                  <p className="text-[11px] text-slate-500">{node.hint}</p>
                </div>
                <span className={`text-lg font-semibold ${node.tone}`}>{node.value}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="relative mx-auto flex h-36 w-36 items-center justify-center rounded-full border-8 border-blue-100 bg-white text-center shadow-sm">
          <div className="absolute left-[-24px] top-1/2 hidden h-px w-6 -translate-y-1/2 bg-slate-300 lg:block" />
          <div className="absolute right-[-24px] top-1/2 hidden h-px w-6 -translate-y-1/2 bg-slate-300 lg:block" />
          <div>
            <p className="text-2xl font-semibold text-slate-900">{centerValue}</p>
            <p className="text-xs font-medium text-slate-500">{centerLabel}</p>
          </div>
        </div>

        <div className="space-y-3">
          {rightNodes.map((node) => (
            <div key={node.label} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 lg:ml-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-slate-700">{node.label}</p>
                  <p className="text-[11px] text-slate-500">{node.hint}</p>
                </div>
                <span className={`text-lg font-semibold ${node.tone}`}>{node.value}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ERMOverviewPage() {
  const [hoveredCell, setHoveredCell] = useState<{ likelihood: number; impact: number } | null>(null);
  const [heatmapType, setHeatmapType] = useState<'inherent' | 'residual'>('inherent');
  const [topRiskSort, setTopRiskSort] = useState<'inherent' | 'residual'>('inherent');

  const { data: dashboard, isLoading: dashboardLoading } = useQuery({
    queryKey: ['erm-risks-dashboard'],
    queryFn: async () => {
      const response = await ermApi.risks.getDashboard();
      return response.data;
    },
  });

  const { data: risks } = useQuery({
    queryKey: ['erm-risks-all'],
    queryFn: async () => {
      const response = await ermApi.risks.getAll();
      return response.data;
    },
  });

  const { data: heatmapData } = useQuery({
    queryKey: ['erm-heatmap', heatmapType],
    queryFn: async () => {
      const response = await ermApi.risks.getHeatmap(heatmapType);
      return response.data;
    },
  });

  const { data: kriAlerts } = useQuery({
    queryKey: ['erm-kri-alerts'],
    queryFn: async () => {
      const response = await ermApi.kris.getAlerts();
      return response.data;
    },
  });

  const { data: allKris } = useQuery({
    queryKey: ['erm-all-kris'],
    queryFn: async () => {
      const response = await ermApi.kris.getAll();
      return response.data;
    },
  });

  const { data: overdueActions } = useQuery({
    queryKey: ['erm-overdue-actions'],
    queryFn: async () => {
      const response = await ermApi.mitigationActions.getOverdue();
      return response.data;
    },
  });

  const { data: incidents } = useQuery({
    queryKey: ['erm-recent-incidents'],
    queryFn: async () => {
      const response = await ermApi.incidents.getAll();
      return response.data;
    },
  });

  const { data: appetiteData } = useQuery({
    queryKey: ['erm-appetite-stats'],
    queryFn: async () => {
      try {
        const response = await ermApi.appetite.getWithStats();
        return response.data;
      } catch {
        return null;
      }
    },
  });

  const heatmapMatrix = useMemo(() => {
    const matrix: Record<string, HeatmapCellData> = {};
    for (let l = 1; l <= 5; l++) {
      for (let i = 1; i <= 5; i++) {
        matrix[`${l}-${i}`] = { count: 0, risks: [] };
      }
    }
    if (heatmapData) {
      heatmapData.forEach((cell) => {
        const key = `${cell.likelihood}-${cell.impact}`;
        if (matrix[key]) {
          matrix[key] = { count: cell.count, risks: cell.risks };
        }
      });
    }
    return matrix;
  }, [heatmapData]);

  const categoryData = useMemo(() => {
    const byCategory = dashboard?.by_category || {};
    const categories = Object.entries(byCategory).map(([category, count]) => {
      const categoryRisks = risks?.filter(r => (r.risk_category || 'operational') === category) || [];
      const avgScore = categoryRisks.length > 0
        ? categoryRisks.reduce((sum, r) => sum + (r.residual_score || r.inherent_score || 0), 0) / categoryRisks.length
        : 0;
      return {
        category,
        label: CATEGORY_LABELS[category] || category,
        count: count as number,
        avgScore: Math.round(avgScore * 10) / 10,
        color: CATEGORY_COLORS[category] || '#6366f1',
      };
    });
    return categories.sort((a, b) => b.count - a.count);
  }, [dashboard?.by_category, risks]);

  const mitigationProgress = useMemo(() => {
    if (!risks) return { completed: 0, inProgress: 0, total: 0, percentage: 0 };
    const allActions = risks.flatMap(r => r.mitigation_actions || []);
    const completed = allActions.filter(a => a.status === 'completed').length;
    const total = allActions.length;
    return {
      completed,
      inProgress: allActions.filter(a => a.status === 'in_progress').length,
      total,
      percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  }, [risks]);

  const avgRiskScore = useMemo(() => {
    const avgResidual = dashboard?.avg_residual_score || 0;
    const maxScore = 25;
    return {
      value: avgResidual,
      percentage: Math.round((avgResidual / maxScore) * 100),
    };
  }, [dashboard?.avg_residual_score]);

  const kriSummary = useMemo(() => {
    if (!allKris) return { green: 0, amber: 0, red: 0, total: 0 };
    const green = allKris.filter(k => k.current_status === 'green').length;
    const amber = allKris.filter(k => k.current_status === 'amber').length;
    const red = allKris.filter(k => k.current_status === 'red').length;
    return { green, amber, red, total: allKris.length };
  }, [allKris]);

  const treatmentDistribution = useMemo(() => {
    if (!risks) return [];
    const counts: Record<string, number> = { mitigate: 0, accept: 0, transfer: 0, avoid: 0 };
    risks.forEach((risk: any) => {
      const treatment = (risk.treatment || risk.risk_treatment || 'mitigate').toLowerCase();
      if (counts[treatment] !== undefined) {
        counts[treatment] += 1;
      } else {
        counts.mitigate += 1;
      }
    });

    return Object.entries(counts)
      .filter(([, value]) => value > 0)
      .map(([name, value]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        value,
        fill: TREATMENT_COLORS[name] || '#6366f1',
      }));
  }, [risks]);

  const inherentVsResidual = useMemo(() => {
    if (!risks) return [];
    const byCategory: Record<string, { inherent: number[]; residual: number[] }> = {};

    risks.forEach((risk: any) => {
      const category = risk.risk_category || 'operational';
      if (!byCategory[category]) {
        byCategory[category] = { inherent: [], residual: [] };
      }
      byCategory[category].inherent.push(risk.inherent_score || 0);
      byCategory[category].residual.push(risk.residual_score || risk.inherent_score || 0);
    });

    return Object.entries(byCategory).map(([category, scores]) => ({
      category: CATEGORY_LABELS[category] || category,
      inherent: Math.round((scores.inherent.reduce((sum, value) => sum + value, 0) / scores.inherent.length) * 10) / 10,
      residual: Math.round((scores.residual.reduce((sum, value) => sum + value, 0) / scores.residual.length) * 10) / 10,
    }));
  }, [risks]);


  const topRisks = useMemo(() => {
    if (!risks) return [];
    const sorted = [...risks].sort((a: any, b: any) => {
      if (topRiskSort === 'inherent') {
        return (b.inherent_score || 0) - (a.inherent_score || 0);
      }
      return (b.residual_score || b.inherent_score || 0) - (a.residual_score || a.inherent_score || 0);
    });
    return sorted.slice(0, 10);
  }, [risks, topRiskSort]);

  const appetiteUtilization = useMemo(() => {
    if (!appetiteData || !Array.isArray(appetiteData)) return [];

    return appetiteData.slice(0, 6).map((item: any) => {
      const current = item.current_avg_score || item.avg_score || 0;
      const threshold = item.max_acceptable_score || item.tolerance_threshold || 25;
      const utilization = threshold > 0 ? Math.round((current / threshold) * 100) : 0;

      return {
        category: CATEGORY_LABELS[item.category] || item.category || 'Unknown',
        current: Math.round(current * 10) / 10,
        threshold,
        utilization: Math.min(utilization, 150),
        status: utilization >= 100 ? 'breach' : utilization >= 75 ? 'warning' : 'normal',
      };
    });
  }, [appetiteData]);

  const totalRisks = dashboard?.total_risks || 0;
  const openRisks = dashboard?.open_risks || 0;
  const closedRisks = totalRisks - openRisks;
  const criticalHighRisks = (dashboard?.by_score_range?.critical || 0) + (dashboard?.by_score_range?.high || 0);
  const recentIncidents = incidents?.slice(0, 5) || [];
  const appetiteBreaches = appetiteUtilization.filter((item) => item.status === 'breach').length;
  const residualHealth = Math.max(0, 100 - Math.round((avgRiskScore.value / 25) * 100));
  const exposureHealth = totalRisks > 0 ? Math.max(0, 100 - Math.round((criticalHighRisks / totalRisks) * 100)) : 100;
  const kriHealth = kriSummary.total > 0 ? Math.max(0, 100 - Math.round((kriSummary.red / kriSummary.total) * 100)) : 100;
  const actionHealth = mitigationProgress.total > 0
    ? Math.round((mitigationProgress.percentage * 0.7) + (Math.max(0, 100 - Math.round(((overdueActions?.length || 0) / mitigationProgress.total) * 100)) * 0.3))
    : 100;
  const ermHealthScore = Math.round((residualHealth * 0.35) + (exposureHealth * 0.25) + (kriHealth * 0.2) + (actionHealth * 0.2));

  const scoreRangeData = [
    { name: 'Critical', value: dashboard?.by_score_range?.critical || 0, color: '#ef4444' },
    { name: 'High', value: dashboard?.by_score_range?.high || 0, color: '#f97316' },
    { name: 'Medium', value: dashboard?.by_score_range?.medium || 0, color: '#eab308' },
    { name: 'Low', value: dashboard?.by_score_range?.low || 0, color: '#22c55e' },
  ];

  const categoryExposureItems = categoryData.slice(0, 6).map((item) => ({
    label: item.label,
    value: item.avgScore,
    color: item.avgScore >= 15 ? '#ef4444' : item.avgScore >= 8 ? '#f59e0b' : '#10b981',
    meta: `${item.count} risks`,
  }));

  const sunburstRings = [
    {
      label: 'Score mix',
      items: scoreRangeData,
    },
    {
      label: 'Treatment mix',
      items: treatmentDistribution.map((item) => ({ name: item.name, value: item.value, color: item.fill })),
    },
    {
      label: 'Signals',
      items: [
        { name: 'Red KRIs', value: kriSummary.red, color: '#ef4444' },
        { name: 'Critical incidents', value: (incidents || []).filter((incident: any) => ['critical', 'high'].includes((incident.severity || '').toLowerCase())).length, color: '#8b5cf6' },
        { name: 'Overdue actions', value: overdueActions?.length || 0, color: '#f59e0b' },
      ],
    },
  ];

  const bowTieLeftNodes = [
    { label: 'Critical / High', value: criticalHighRisks, hint: 'priority exposure', tone: 'text-rose-600' },
    { label: 'Red KRIs', value: kriSummary.red, hint: 'threshold breaches', tone: 'text-amber-600' },
    { label: 'Incidents', value: incidents?.length || 0, hint: 'reported events', tone: 'text-violet-600' },
  ];

  const bowTieRightNodes = [
    { label: 'Completed', value: mitigationProgress.completed, hint: 'actions closed', tone: 'text-emerald-600' },
    { label: 'In progress', value: mitigationProgress.inProgress, hint: 'being treated', tone: 'text-blue-600' },
    { label: 'Overdue', value: overdueActions?.length || 0, hint: 'needs escalation', tone: 'text-rose-600' },
  ];

  if (dashboardLoading) {
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
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 card">
            <div className="skeleton h-6 w-48 mb-4" />
            <div className="skeleton h-80 w-full rounded-lg" />
          </div>
          <div className="card">
            <div className="skeleton h-6 w-32 mb-4" />
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="skeleton h-12 w-full rounded-lg" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }


  return (
    <div className="space-y-4">

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Risks"
          value={totalRisks}
          subtitle={`${openRisks} open • ${closedRisks} closed`}
          icon={AlertTriangle}
          variant="default"
          onClick={() => window.location.href = '/erm/risks'}
        />
        <StatCard
          title="High/Critical Risks"
          value={criticalHighRisks}
          subtitle={`${dashboard?.by_score_range?.critical || 0} critical • ${dashboard?.by_score_range?.high || 0} high`}
          icon={AlertOctagon}
          variant="danger"
          onClick={() => window.location.href = '/erm/risks'}
        />
        <div className="rounded-xl border border-slate-200 bg-white p-4 hover:border-primary-500/50 hover:shadow-glow-sm transition-all">
          <div className="flex items-center gap-4">
            <ProgressRing
              percentage={avgRiskScore.percentage}
              size={72}
              strokeWidth={6}
              color={avgRiskScore.value >= 15 ? 'danger' : avgRiskScore.value >= 8 ? 'warning' : 'success'}
              showPercentage={false}
            />
            <div>
              <p className="text-sm font-medium text-slate-600">Avg Risk Score</p>
              <p className="text-2xl font-bold text-slate-900">{avgRiskScore.value.toFixed(1)}</p>
              <p className="text-xs text-slate-500">out of 25</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 hover:border-success-500/50 hover:shadow-[0_0_10px_-3px_rgba(34,197,94,0.3)] transition-all">
          <div className="flex items-center gap-4">
            <ProgressRing
              percentage={mitigationProgress.percentage}
              size={72}
              strokeWidth={6}
              color={mitigationProgress.percentage >= 70 ? 'success' : mitigationProgress.percentage >= 40 ? 'warning' : 'danger'}
            />
            <div>
              <p className="text-sm font-medium text-slate-600">Mitigation Progress</p>
              <p className="text-2xl font-bold text-slate-900">{mitigationProgress.percentage}%</p>
              <p className="text-xs text-slate-500">{mitigationProgress.completed}/{mitigationProgress.total} complete</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Risk Heatmap</h2>
              <p className="card-description">5×5 Likelihood vs Impact Matrix</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setHeatmapType('inherent')}
                className={`px-3 py-1.5 text-sm rounded-lg transition-all ${
                  heatmapType === 'inherent'
                    ? 'bg-primary-500 text-slate-900'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Inherent
              </button>
              <button
                onClick={() => setHeatmapType('residual')}
                className={`px-3 py-1.5 text-sm rounded-lg transition-all ${
                  heatmapType === 'residual'
                    ? 'bg-primary-500 text-slate-900'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Residual
              </button>
            </div>
          </div>
          
          <div className="relative">
            <div className="flex">
              <div className="flex flex-col justify-between pr-2 text-xs text-slate-600 py-1" style={{ width: '80px' }}>
                {IMPACT_LABELS.slice().reverse().map((label, idx) => (
                  <div key={idx} className="h-14 flex items-center justify-end text-right">
                    <span className="truncate">{label}</span>
                  </div>
                ))}
              </div>
              
              <div className="flex-1">
                <div className="grid grid-cols-5 gap-1">
                  {[5, 4, 3, 2, 1].map((impact) =>
                    [1, 2, 3, 4, 5].map((likelihood) => {
                      const key = `${likelihood}-${impact}`;
                      const cellData = heatmapMatrix[key];
                      const isHovered = hoveredCell?.likelihood === likelihood && hoveredCell?.impact === impact;
                      
                      return (
                        <div
                          key={key}
                          className={`relative h-14 rounded-lg flex items-center justify-center cursor-pointer transition-all duration-200 ${getHeatmapColor(likelihood, impact)} ${
                            isHovered ? `ring-2 ring-white ring-offset-2 ring-offset-slate-900 scale-105 z-10 ${getHeatmapBorderColor(likelihood, impact)}` : ''
                          }`}
                          onMouseEnter={() => setHoveredCell({ likelihood, impact })}
                          onMouseLeave={() => setHoveredCell(null)}
                        >
                          <span className={`font-bold ${cellData.count > 0 ? 'text-white text-lg' : 'text-white/60 text-sm'}`}>
                            {cellData.count || '-'}
                          </span>
                          
                          {isHovered && cellData.count > 0 && (
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 min-w-[200px] max-w-[280px]">
                              <div className="bg-white border border-slate-300 rounded-lg shadow-xl p-3">
                                <div className="text-xs font-semibold text-slate-900 mb-2 border-b border-slate-300 pb-2">
                                  L{likelihood} × I{impact} = Score {likelihood * impact}
                                </div>
                                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                                  {cellData.risks.slice(0, 5).map((risk) => (
                                    <Link
                                      key={risk.id}
                                      href={`/erm/risks`}
                                      className="block text-xs text-slate-700 hover:text-primary-400 truncate"
                                    >
                                      • {risk.title}
                                    </Link>
                                  ))}
                                  {cellData.risks.length > 5 && (
                                    <p className="text-xs text-slate-500">+{cellData.risks.length - 5} more...</p>
                                  )}
                                </div>
                              </div>
                              <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-slate-600" />
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
                
                <div className="flex justify-between mt-2 px-1">
                  {LIKELIHOOD_LABELS.map((label, idx) => (
                    <div key={idx} className="text-xs text-slate-600 text-center flex-1">
                      {label}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            
            <div className="absolute -left-2 top-1/2 -translate-y-1/2 -rotate-90 text-xs text-slate-500 font-medium whitespace-nowrap origin-center">
              Impact →
            </div>
            <div className="text-center mt-4 text-xs text-slate-500 font-medium">
              Likelihood →
            </div>
            
            <div className="flex items-center justify-center gap-4 mt-4 pt-4 border-t border-slate-200">
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded bg-emerald-500" />
                <span className="text-xs text-slate-600">Low (1-4)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded bg-yellow-500" />
                <span className="text-xs text-slate-600">Medium (5-9)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded bg-amber-500" />
                <span className="text-xs text-slate-600">High (10-14)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded bg-orange-500" />
                <span className="text-xs text-slate-600">Very High (15-19)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded bg-rose-600" />
                <span className="text-xs text-slate-600">Critical (20-25)</span>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Key Risk Indicators</h2>
              <p className="card-description">KRI threshold status</p>
            </div>
            <Link href="/erm/kris" className="btn-ghost btn-sm">
              View All
            </Link>
          </div>
          
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-emerald-400">{kriSummary.green}</p>
              <p className="text-xs text-emerald-400/80">Green</p>
            </div>
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-amber-400">{kriSummary.amber}</p>
              <p className="text-xs text-amber-400/80">Amber</p>
            </div>
            <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-rose-400">{kriSummary.red}</p>
              <p className="text-xs text-rose-400/80">Red</p>
            </div>
          </div>
          
          {kriAlerts && kriAlerts.length > 0 ? (
            <div className="space-y-2">
              {kriAlerts.slice(0, 5).map((kri: any) => (
                <div
                  key={kri.id}
                  className={`flex items-center gap-3 rounded-lg p-3 transition-all ${
                    kri.current_status === 'red'
                      ? 'bg-rose-500/10 border border-rose-500/20 hover:border-rose-500/40'
                      : 'bg-amber-500/10 border border-amber-500/20 hover:border-amber-500/40'
                  }`}
                >
                  <div className={`h-2.5 w-2.5 rounded-full ${
                    kri.current_status === 'red' ? 'bg-rose-500 animate-pulse' : 'bg-amber-500'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{kri.name}</p>
                    <p className="text-xs text-slate-600">
                      {kri.current_value}{kri.unit || ''} / {kri.amber_threshold}
                    </p>
                  </div>
                  {kri.last_measured_at && (
                    <div className="flex items-center text-slate-500">
                      {kri.current_value > (kri.amber_threshold || 0) ? (
                        <TrendingUp className="h-4 w-4 text-rose-400" />
                      ) : (
                        <TrendingDown className="h-4 w-4 text-emerald-400" />
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state py-6">
              <div className="empty-state-icon bg-emerald-500/10">
                <CheckCircle className="h-6 w-6 text-emerald-400" />
              </div>
              <p className="empty-state-title text-sm">All KRIs Normal</p>
              <p className="empty-state-description text-xs">All indicators within thresholds</p>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <RiskSpeedometer
          score={ermHealthScore}
          signals={[
            { label: 'Residual', value: avgRiskScore.value.toFixed(1), tone: 'text-blue-600' },
            { label: 'Priority', value: `${criticalHighRisks}`, tone: 'text-rose-600' },
            { label: 'KRIs Red', value: `${kriSummary.red}`, tone: 'text-amber-600' },
            { label: 'Breaches', value: `${appetiteBreaches}`, tone: 'text-violet-600' },
          ]}
        />
        <RiskSunburst
          rings={sunburstRings}
          centerValue={totalRisks.toLocaleString()}
          centerLabel="tracked risks"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Category Exposure Ladder</h2>
              <p className="card-description">Average residual score with risk count by category</p>
            </div>
          </div>
          <ExposureLollipop items={categoryExposureItems} maxValue={25} />
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Inherent vs Residual Dot Plot</h2>
              <p className="card-description">Score shift by category after treatment</p>
            </div>
          </div>
          <ResidualDotPlot data={inherentVsResidual.slice(0, 6)} />
        </div>
      </div>

      <RiskBowTie
        leftNodes={bowTieLeftNodes}
        rightNodes={bowTieRightNodes}
        centerValue={openRisks.toLocaleString()}
        centerLabel="open risks"
      />

      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">Top 10 Risks</h2>
            <p className="card-description">Highest scoring risks across the organization</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setTopRiskSort('inherent')}
              className={`px-3 py-1.5 text-sm rounded-lg transition-all ${
                topRiskSort === 'inherent'
                  ? 'bg-primary-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              By Inherent
            </button>
            <button
              onClick={() => setTopRiskSort('residual')}
              className={`px-3 py-1.5 text-sm rounded-lg transition-all ${
                topRiskSort === 'residual'
                  ? 'bg-primary-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              By Residual
            </button>
          </div>
        </div>
        {topRisks.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-3 px-3 text-slate-600 font-medium">#</th>
                  <th className="text-left py-3 px-3 text-slate-600 font-medium">Risk Title</th>
                  <th className="text-center py-3 px-3 text-slate-600 font-medium">Inherent</th>
                  <th className="text-center py-3 px-3 text-slate-600 font-medium">Residual</th>
                  <th className="text-center py-3 px-3 text-slate-600 font-medium">Trend</th>
                </tr>
              </thead>
              <tbody>
                {topRisks.map((risk: any, index: number) => {
                  const inherent = risk.inherent_score || 0;
                  const residual = risk.residual_score || inherent;

                  return (
                    <tr key={risk.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-3 text-slate-500">{index + 1}</td>
                      <td className="py-3 px-3 text-slate-900 font-medium truncate max-w-[320px]">{risk.name || risk.title}</td>
                      <td className="py-3 px-3 text-center text-slate-900">{inherent}</td>
                      <td className="py-3 px-3 text-center text-slate-900">{residual}</td>
                      <td className="py-3 px-3 text-center">
                        {residual < inherent ? (
                          <TrendingDown className="h-4 w-4 text-emerald-500 mx-auto" />
                        ) : residual > inherent ? (
                          <TrendingUp className="h-4 w-4 text-rose-500 mx-auto" />
                        ) : (
                          <Minus className="h-4 w-4 text-slate-500 mx-auto" />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state py-8">
            <div className="empty-state-icon">
              <AlertTriangle className="h-8 w-8 text-slate-500" />
            </div>
            <p className="empty-state-title">No Risks Found</p>
            <p className="empty-state-description text-sm">Add risks to see the top risk table</p>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">KRI Gauge Panel</h2>
              <p className="card-description">Current value vs threshold</p>
            </div>
          </div>
          {allKris && allKris.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {allKris.slice(0, 6).map((kri: any) => {
                const current = kri.current_value || 0;
                const red = kri.red_threshold || kri.amber_threshold * 1.5 || 100;
                const amber = kri.amber_threshold || red * 0.7;
                const maxVal = Math.max(red * 1.2, current * 1.1, 1);
                const pct = Math.min(Math.round((current / maxVal) * 100), 100);
                const status = current >= red ? 'red' : current >= amber ? 'amber' : 'green';
                const statusColor = status === 'red' ? '#ef4444' : status === 'amber' ? '#f59e0b' : '#10b981';

                return (
                  <div key={kri.id} className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-center mb-2">
                      <div className="relative w-16 h-16">
                        <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
                          <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(100,116,139,0.25)" strokeWidth="3" />
                          <circle
                            cx="18"
                            cy="18"
                            r="15.5"
                            fill="none"
                            stroke={statusColor}
                            strokeWidth="3"
                            strokeDasharray={`${pct * 0.975} 97.5`}
                            strokeLinecap="round"
                            className="transition-all duration-700"
                          />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-xs font-bold text-slate-900">{current}</span>
                        </div>
                      </div>
                    </div>
                    <p className="text-xs font-medium text-slate-900 text-center truncate">{kri.name}</p>
                    <p className="text-[10px] text-slate-600 text-center mt-0.5">Threshold: {amber}{kri.unit || ''}</p>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty-state py-8">
              <div className="empty-state-icon">
                <Gauge className="h-8 w-8 text-slate-500" />
              </div>
              <p className="empty-state-title">No KRIs Configured</p>
              <p className="empty-state-description text-sm">Set up Key Risk Indicators to monitor</p>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Risk Appetite Utilization</h2>
              <p className="card-description">Current risk vs appetite thresholds</p>
            </div>
          </div>
          {appetiteUtilization.length > 0 ? (
            <div className="space-y-4">
              {appetiteUtilization.map((item, index) => {
                const barColor = item.status === 'breach' ? 'bg-rose-500' : item.status === 'warning' ? 'bg-amber-500' : 'bg-emerald-500';
                const textColor = item.status === 'breach' ? 'text-rose-500' : item.status === 'warning' ? 'text-amber-600' : 'text-emerald-600';

                return (
                  <div key={index}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm text-slate-700">{item.category}</span>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-medium ${textColor}`}>
                          {item.current} / {item.threshold}
                        </span>
                        {item.status === 'breach' && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-100 text-rose-600">
                            <Zap className="h-3 w-3" /> Breach
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full ${barColor} rounded-full transition-all duration-500`} style={{ width: `${Math.min(item.utilization, 100)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty-state py-8">
              <div className="empty-state-icon">
                <Target className="h-8 w-8 text-slate-500" />
              </div>
              <p className="empty-state-title">No Appetite Data</p>
              <p className="empty-state-description text-sm">Configure appetite thresholds to track utilization</p>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Risks by Category</h2>
              <p className="card-description">Distribution and average scores</p>
            </div>
          </div>
          
          {categoryData.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryData} layout="vertical" margin={{ left: 0, right: 20 }}>
                  <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={100}
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1e293b',
                      border: '1px solid #475569',
                      borderRadius: '8px',
                      color: '#f1f5f9',
                    }}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={24}>
                    {categoryData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="empty-state py-8">
              <div className="empty-state-icon">
                <BarChart3 className="h-8 w-8 text-slate-500" />
              </div>
              <p className="empty-state-title">No Category Data</p>
              <p className="empty-state-description text-sm">Add risks to see category distribution</p>
            </div>
          )}
          
          <div className="mt-4 pt-4 border-t border-slate-200">
            <div className="flex flex-wrap gap-3">
              {categoryData.slice(0, 5).map((cat) => (
                <div key={cat.category} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded" style={{ backgroundColor: cat.color }} />
                  <span className="text-xs text-slate-600">
                    {cat.label}: <span className="text-slate-900 font-medium">{cat.count}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Mitigation Actions</h2>
              <p className="card-description">Pending and overdue actions</p>
            </div>
            <Link href="/erm/mitigation-actions" className="btn-ghost btn-sm">
              View All
            </Link>
          </div>
          
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-slate-600">Overall Progress</span>
              <span className="text-sm font-medium text-slate-900">{mitigationProgress.completed}/{mitigationProgress.total}</span>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary-500 to-primary-400 rounded-full transition-all duration-500"
                style={{ width: `${mitigationProgress.percentage}%` }}
              />
            </div>
          </div>
          
          {overdueActions && overdueActions.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-rose-400 flex items-center gap-1.5 mb-3">
                <AlertCircle className="h-3.5 w-3.5" />
                {overdueActions.length} Overdue Actions
              </p>
              {overdueActions.slice(0, 4).map((action: any) => (
                <div
                  key={action.id}
                  className="flex items-center gap-3 rounded-lg bg-rose-500/5 border border-rose-500/20 p-3 hover:border-rose-500/40 transition-all"
                >
                  <div className="flex-shrink-0">
                    <Clock className="h-4 w-4 text-rose-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{action.title}</p>
                    <div className="flex items-center gap-2 text-xs text-slate-600">
                      {action.owner_name && (
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {action.owner_name}
                        </span>
                      )}
                      {action.due_date && (
                        <span className="flex items-center gap-1 text-rose-400">
                          <Calendar className="h-3 w-3" />
                          {new Date(action.due_date).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="badge-danger text-xs">Overdue</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state py-6">
              <div className="empty-state-icon bg-emerald-500/10">
                <CheckCircle className="h-6 w-6 text-emerald-400" />
              </div>
              <p className="empty-state-title text-sm">No Overdue Actions</p>
              <p className="empty-state-description text-xs">All actions are on track</p>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Recent Incidents</h2>
              <p className="card-description">Latest reported risk events</p>
            </div>
            <Link href="/erm/incidents" className="btn-ghost btn-sm">
              View All
            </Link>
          </div>
          
          {recentIncidents.length > 0 ? (
            <div className="space-y-3">
              {recentIncidents.map((incident: any) => (
                <div
                  key={incident.id}
                  className="flex items-center gap-3 rounded-lg border border-slate-200/50 bg-white/30 p-3 hover:border-slate-300 hover:bg-white/50 transition-all"
                >
                  <div className={`rounded-lg p-2 ${
                    incident.severity === 'critical' ? 'bg-rose-500/20' :
                    incident.severity === 'high' ? 'bg-orange-500/20' :
                    incident.severity === 'medium' ? 'bg-amber-500/20' : 'bg-slate-100/50'
                  }`}>
                    <AlertCircle className={`h-4 w-4 ${
                      incident.severity === 'critical' ? 'text-rose-400' :
                      incident.severity === 'high' ? 'text-orange-400' :
                      incident.severity === 'medium' ? 'text-amber-400' : 'text-slate-600'
                    }`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{incident.title}</p>
                    <p className="text-xs text-slate-600">
                      {new Date(incident.incident_date).toLocaleDateString()}
                      {incident.risk_title && ` • ${incident.risk_title}`}
                    </p>
                  </div>
                  <span className={`badge-${
                    incident.severity === 'critical' || incident.severity === 'high' ? 'danger' :
                    incident.severity === 'medium' ? 'warning' : 'neutral'
                  }`}>
                    {incident.severity}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state py-8">
              <div className="empty-state-icon">
                <Shield className="h-8 w-8 text-slate-500" />
              </div>
              <p className="empty-state-title">No Recent Incidents</p>
              <p className="empty-state-description text-sm">No incidents have been recorded</p>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Risk Score Distribution</h2>
              <p className="card-description">By severity level</p>
            </div>
          </div>
          
          <div className="space-y-4">
            {[
              { label: 'Critical', color: 'rose', count: dashboard?.by_score_range?.critical || 0, range: '20-25' },
              { label: 'High', color: 'orange', count: dashboard?.by_score_range?.high || 0, range: '12-19' },
              { label: 'Medium', color: 'amber', count: dashboard?.by_score_range?.medium || 0, range: '6-11' },
              { label: 'Low', color: 'emerald', count: dashboard?.by_score_range?.low || 0, range: '1-5' },
            ].map((item) => {
              const percentage = totalRisks > 0 ? (item.count / totalRisks) * 100 : 0;
              return (
                <div key={item.label}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded bg-${item.color}-500`} />
                      <span className="text-sm text-slate-700">{item.label}</span>
                      <span className="text-xs text-slate-500">({item.range})</span>
                    </div>
                    <span className="text-sm font-semibold text-slate-900">{item.count}</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full bg-${item.color}-500 rounded-full transition-all duration-500`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          
          <div className="mt-6 pt-4 border-t border-slate-200">
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-3 rounded-lg bg-white/50">
                <p className="text-2xl font-bold text-slate-900">{dashboard?.avg_inherent_score?.toFixed(1) || '0.0'}</p>
                <p className="text-xs text-slate-600">Avg Inherent Score</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-white/50">
                <p className="text-2xl font-bold text-slate-900">{dashboard?.avg_residual_score?.toFixed(1) || '0.0'}</p>
                <p className="text-xs text-slate-600">Avg Residual Score</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        <Link
          href="/erm/risks"
          className="card group hover:border-primary-500/30 transition-all duration-200"
        >
          <div className="flex items-center gap-4">
            <div className="rounded-xl bg-gradient-to-br from-primary-500/20 to-primary-600/10 p-3 group-hover:from-primary-500/30 group-hover:to-primary-600/20 transition-all">
              <AlertTriangle className="h-5 w-5 text-primary-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-slate-900 group-hover:text-primary-300 transition-colors truncate">Risk Register</p>
              <p className="text-xs text-slate-600">Manage all risks</p>
            </div>
            <ChevronRight className="h-5 w-5 text-slate-600 group-hover:text-primary-400 transition-colors" />
          </div>
        </Link>

        <Link
          href="/erm/kris"
          className="card group hover:border-cyan-500/30 transition-all duration-200"
        >
          <div className="flex items-center gap-4">
            <div className="rounded-xl bg-gradient-to-br from-cyan-500/20 to-cyan-600/10 p-3 group-hover:from-cyan-500/30 group-hover:to-cyan-600/20 transition-all">
              <Activity className="h-5 w-5 text-cyan-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-slate-900 group-hover:text-cyan-300 transition-colors truncate">KRIs</p>
              <p className="text-xs text-slate-600">Monitor indicators</p>
            </div>
            <ChevronRight className="h-5 w-5 text-slate-600 group-hover:text-cyan-400 transition-colors" />
          </div>
        </Link>

        <Link
          href="/erm/mitigation-actions"
          className="card group hover:border-emerald-500/30 transition-all duration-200"
        >
          <div className="flex items-center gap-4">
            <div className="rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 p-3 group-hover:from-emerald-500/30 group-hover:to-emerald-600/20 transition-all">
              <Target className="h-5 w-5 text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-slate-900 group-hover:text-emerald-300 transition-colors truncate">Mitigations</p>
              <p className="text-xs text-slate-600">Track actions</p>
            </div>
            <ChevronRight className="h-5 w-5 text-slate-600 group-hover:text-emerald-400 transition-colors" />
          </div>
        </Link>

        <Link
          href="/erm/reports"
          className="card group hover:border-purple-500/30 transition-all duration-200"
        >
          <div className="flex items-center gap-4">
            <div className="rounded-xl bg-gradient-to-br from-purple-500/20 to-purple-600/10 p-3 group-hover:from-purple-500/30 group-hover:to-purple-600/20 transition-all">
              <BarChart3 className="h-5 w-5 text-purple-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-slate-900 group-hover:text-purple-300 transition-colors truncate">Reports</p>
              <p className="text-xs text-slate-600">Generate reports</p>
            </div>
            <ChevronRight className="h-5 w-5 text-slate-600 group-hover:text-purple-400 transition-colors" />
          </div>
        </Link>

        <Link
          href="/erm/analytics"
          className="card group hover:border-blue-500/30 transition-all duration-200"
        >
          <div className="flex items-center gap-4">
            <div className="rounded-xl bg-gradient-to-br from-blue-500/20 to-blue-600/10 p-3 group-hover:from-blue-500/30 group-hover:to-blue-600/20 transition-all">
              <TrendingUp className="h-5 w-5 text-blue-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-slate-900 group-hover:text-blue-300 transition-colors truncate">Analytics</p>
              <p className="text-xs text-slate-600">Advanced analysis</p>
            </div>
            <ChevronRight className="h-5 w-5 text-slate-600 group-hover:text-blue-400 transition-colors" />
          </div>
        </Link>
      </div>
    </div>
  );
}
