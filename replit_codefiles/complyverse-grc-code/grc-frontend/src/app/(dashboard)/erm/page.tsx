'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ermApi, dashboardApi } from '@/lib/api';
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
  RadialBarChart,
  RadialBar,
  Legend,
} from 'recharts';

const CATEGORY_COLORS: Record<string, string> = {
  strategic: '#8b5cf6',
  operational: '#3b82f6',
  financial: '#10b981',
  compliance: '#f59e0b',
  technology: '#06b6d4',
  reputational: '#ec4899',
  third_party: '#f97316',
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
  mitigate: '#3b82f6',
  accept: '#10b981',
  transfer: '#f59e0b',
  avoid: '#ef4444',
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#dc2626',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e',
};

const LIKELIHOOD_LABELS = ['Rare', 'Unlikely', 'Possible', 'Likely', 'Almost Certain'];
const IMPACT_LABELS = ['Insignificant', 'Minor', 'Moderate', 'Major', 'Catastrophic'];

function getHeatmapColor(likelihood: number, impact: number): string {
  const score = likelihood * impact;
  if (score >= 20) return 'bg-rose-600 hover:bg-rose-500';
  if (score >= 15) return 'bg-orange-500 hover:bg-orange-400';
  if (score >= 10) return 'bg-amber-500 hover:bg-amber-400';
  if (score >= 5) return 'bg-yellow-500 hover:bg-yellow-400';
  return 'bg-emerald-500 hover:bg-emerald-400';
}

function getHeatmapBorderColor(likelihood: number, impact: number): string {
  const score = likelihood * impact;
  if (score >= 20) return 'border-rose-400';
  if (score >= 15) return 'border-orange-300';
  if (score >= 10) return 'border-amber-300';
  if (score >= 5) return 'border-yellow-300';
  return 'border-emerald-300';
}

interface HeatmapCellData {
  count: number;
  risks: Array<{ id: number; title: string; score: number }>;
}

const darkTooltipStyle = {
  backgroundColor: '#1e293b',
  border: '1px solid #475569',
  borderRadius: '8px',
  color: '#f1f5f9',
};

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

  const { data: enhancedStats } = useQuery({
    queryKey: ['dashboard-enhanced-stats'],
    queryFn: async () => {
      const response = await dashboardApi.getEnhancedStats();
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
      heatmapData.forEach((cell: any) => {
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
      const categoryRisks = risks?.filter((r: any) => (r.risk_category || 'operational') === category) || [];
      const avgScore = categoryRisks.length > 0
        ? categoryRisks.reduce((sum: number, r: any) => sum + (r.residual_score || r.inherent_score || 0), 0) / categoryRisks.length
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
    if (!risks) return { completed: 0, inProgress: 0, notStarted: 0, overdue: 0, total: 0, percentage: 0 };
    const allActions = risks.flatMap((r: any) => r.mitigation_actions || []);
    const completed = allActions.filter((a: any) => a.status === 'completed').length;
    const inProgress = allActions.filter((a: any) => a.status === 'in_progress').length;
    const notStarted = allActions.filter((a: any) => a.status === 'not_started' || a.status === 'pending').length;
    const overdue = overdueActions?.length || 0;
    const total = allActions.length;
    return {
      completed,
      inProgress,
      notStarted,
      overdue,
      total,
      percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  }, [risks, overdueActions]);

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
    const green = allKris.filter((k: any) => k.current_status === 'green').length;
    const amber = allKris.filter((k: any) => k.current_status === 'amber').length;
    const red = allKris.filter((k: any) => k.current_status === 'red').length;
    return { green, amber, red, total: allKris.length };
  }, [allKris]);

  const treatmentDistribution = useMemo(() => {
    if (!risks) return [];
    const counts: Record<string, number> = { mitigate: 0, accept: 0, transfer: 0, avoid: 0 };
    risks.forEach((r: any) => {
      const treatment = (r.treatment || r.risk_treatment || 'mitigate').toLowerCase();
      if (counts[treatment] !== undefined) {
        counts[treatment]++;
      } else {
        counts.mitigate++;
      }
    });
    return Object.entries(counts)
      .filter(([_, v]) => v > 0)
      .map(([name, value]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        value,
        fill: TREATMENT_COLORS[name] || '#6366f1',
      }));
  }, [risks]);

  const inherentVsResidual = useMemo(() => {
    if (!risks) return [];
    const byCat: Record<string, { inherent: number[]; residual: number[] }> = {};
    risks.forEach((r: any) => {
      const cat = r.risk_category || 'operational';
      if (!byCat[cat]) byCat[cat] = { inherent: [], residual: [] };
      byCat[cat].inherent.push(r.inherent_score || 0);
      byCat[cat].residual.push(r.residual_score || r.inherent_score || 0);
    });
    return Object.entries(byCat).map(([cat, scores]) => ({
      category: CATEGORY_LABELS[cat] || cat,
      inherent: Math.round((scores.inherent.reduce((a, b) => a + b, 0) / scores.inherent.length) * 10) / 10,
      residual: Math.round((scores.residual.reduce((a, b) => a + b, 0) / scores.residual.length) * 10) / 10,
    }));
  }, [risks]);

  const riskMovement = useMemo(() => {
    if (!risks) return { improved: 0, unchanged: 0, worsened: 0 };
    let improved = 0, unchanged = 0, worsened = 0;
    risks.forEach((r: any) => {
      const inherent = r.inherent_score || 0;
      const residual = r.residual_score || inherent;
      if (residual < inherent) improved++;
      else if (residual > inherent) worsened++;
      else unchanged++;
    });
    return { improved, unchanged, worsened };
  }, [risks]);

  const mitigationTimelineData = useMemo(() => {
    return [
      { name: 'Completed', value: mitigationProgress.completed, fill: '#10b981' },
      { name: 'In Progress', value: mitigationProgress.inProgress, fill: '#3b82f6' },
      { name: 'Overdue', value: mitigationProgress.overdue, fill: '#ef4444' },
      { name: 'Not Started', value: mitigationProgress.notStarted, fill: '#6b7280' },
    ].filter(d => d.value > 0);
  }, [mitigationProgress]);

  const topRisks = useMemo(() => {
    if (!risks) return [];
    const sorted = [...risks].sort((a: any, b: any) => {
      if (topRiskSort === 'inherent') return (b.inherent_score || 0) - (a.inherent_score || 0);
      return (b.residual_score || b.inherent_score || 0) - (a.residual_score || a.inherent_score || 0);
    });
    return sorted.slice(0, 10);
  }, [risks, topRiskSort]);

  const incidentSeverity = useMemo(() => {
    if (!incidents) return [];
    const counts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    incidents.forEach((inc: any) => {
      const sev = (inc.severity || 'medium').toLowerCase();
      if (counts[sev] !== undefined) counts[sev]++;
      else counts.medium++;
    });
    return Object.entries(counts)
      .filter(([_, v]) => v > 0)
      .map(([name, value]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        value,
        fill: SEVERITY_COLORS[name] || '#6b7280',
      }));
  }, [incidents]);

  const appetiteUtilization = useMemo(() => {
    if (!appetiteData || !Array.isArray(appetiteData)) return [];
    return appetiteData.slice(0, 6).map((item: any) => {
      const current = item.current_avg_score || item.avg_score || 0;
      const max = item.max_acceptable_score || item.tolerance_threshold || 25;
      const pct = max > 0 ? Math.round((current / max) * 100) : 0;
      return {
        category: CATEGORY_LABELS[item.category] || item.category || 'Unknown',
        current: Math.round(current * 10) / 10,
        threshold: max,
        utilization: Math.min(pct, 150),
        status: pct >= 100 ? 'breach' : pct >= 75 ? 'warning' : 'normal',
      };
    });
  }, [appetiteData]);

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

  const totalRisks = dashboard?.total_risks || 0;
  const openRisks = dashboard?.open_risks || 0;
  const closedRisks = totalRisks - openRisks;
  const criticalHighRisks = (dashboard?.by_score_range?.critical || 0) + (dashboard?.by_score_range?.high || 0);
  const totalMovement = riskMovement.improved + riskMovement.unchanged + riskMovement.worsened;

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">Enterprise Risk Management</h1>
        <p className="page-description">Monitor, assess, and mitigate organizational risks</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Risks"
          value={totalRisks}
          subtitle={`${openRisks} open · ${closedRisks} closed`}
          icon={AlertTriangle}
          variant="default"
          onClick={() => window.location.href = '/erm/risks'}
        />
        <StatCard
          title="High/Critical Risks"
          value={criticalHighRisks}
          subtitle={`${dashboard?.by_score_range?.critical || 0} critical · ${dashboard?.by_score_range?.high || 0} high`}
          icon={AlertOctagon}
          variant="danger"
          onClick={() => window.location.href = '/erm/risks'}
        />
        <div className="rounded-xl border border-slate-700 bg-surface-800 p-4 hover:border-primary-500/50 hover:shadow-glow-sm transition-all">
          <div className="flex items-center gap-4">
            <ProgressRing
              percentage={avgRiskScore.percentage}
              size={72}
              strokeWidth={6}
              color={avgRiskScore.value >= 15 ? 'danger' : avgRiskScore.value >= 8 ? 'warning' : 'success'}
              showPercentage={false}
            />
            <div>
              <p className="text-sm font-medium text-slate-400">Avg Risk Score</p>
              <p className="text-2xl font-bold text-white">{avgRiskScore.value.toFixed(1)}</p>
              <p className="text-xs text-slate-500">out of 25</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-700 bg-surface-800 p-4 hover:border-success-500/50 hover:shadow-[0_0_10px_-3px_rgba(34,197,94,0.3)] transition-all">
          <div className="flex items-center gap-4">
            <ProgressRing
              percentage={mitigationProgress.percentage}
              size={72}
              strokeWidth={6}
              color={mitigationProgress.percentage >= 70 ? 'success' : mitigationProgress.percentage >= 40 ? 'warning' : 'danger'}
            />
            <div>
              <p className="text-sm font-medium text-slate-400">Mitigation Progress</p>
              <p className="text-2xl font-bold text-white">{mitigationProgress.percentage}%</p>
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
                    ? 'bg-primary-500 text-white'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                Inherent
              </button>
              <button
                onClick={() => setHeatmapType('residual')}
                className={`px-3 py-1.5 text-sm rounded-lg transition-all ${
                  heatmapType === 'residual'
                    ? 'bg-primary-500 text-white'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                Residual
              </button>
            </div>
          </div>
          
          <div className="relative">
            <div className="flex">
              <div className="flex flex-col justify-between pr-2 text-xs text-slate-400 py-1" style={{ width: '80px' }}>
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
                          <span className={`font-bold ${cellData.count > 0 ? 'text-white text-lg' : 'text-white/50 text-sm'}`}>
                            {cellData.count || '-'}
                          </span>
                          
                          {isHovered && cellData.count > 0 && (
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 min-w-[200px] max-w-[280px]">
                              <div className="bg-slate-800 border border-slate-600 rounded-lg shadow-xl p-3">
                                <div className="text-xs font-semibold text-white mb-2 border-b border-slate-600 pb-2">
                                  L{likelihood} × I{impact} = Score {likelihood * impact}
                                </div>
                                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                                  {cellData.risks.slice(0, 5).map((risk) => (
                                    <Link
                                      key={risk.id}
                                      href={`/erm/risks`}
                                      className="block text-xs text-slate-300 hover:text-primary-400 truncate"
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
                    <div key={idx} className="text-xs text-slate-400 text-center flex-1">
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
            
            <div className="flex items-center justify-center gap-4 mt-4 pt-4 border-t border-slate-700">
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded bg-emerald-500" />
                <span className="text-xs text-slate-400">Low (1-4)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded bg-yellow-500" />
                <span className="text-xs text-slate-400">Medium (5-9)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded bg-amber-500" />
                <span className="text-xs text-slate-400">High (10-14)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded bg-orange-500" />
                <span className="text-xs text-slate-400">Very High (15-19)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded bg-rose-600" />
                <span className="text-xs text-slate-400">Critical (20-25)</span>
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
                    <p className="text-sm font-medium text-white truncate">{kri.name}</p>
                    <p className="text-xs text-slate-400">
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

      {/* NEW WIDGET ROW: Treatment Donut + Inherent vs Residual + Risk Movement */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Risk Treatment Status</h2>
              <p className="card-description">Distribution by treatment type</p>
            </div>
          </div>
          {treatmentDistribution.length > 0 ? (
            <div className="flex flex-col items-center">
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={treatmentDistribution}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={80}
                      paddingAngle={3}
                      dataKey="value"
                      strokeWidth={0}
                    >
                      {treatmentDistribution.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={darkTooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap justify-center gap-3 -mt-2">
                {treatmentDistribution.map((d, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-xs">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.fill }} />
                    <span className="text-slate-400">{d.name}</span>
                    <span className="text-white font-medium">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="empty-state py-8">
              <div className="empty-state-icon">
                <Shield className="h-8 w-8 text-slate-500" />
              </div>
              <p className="empty-state-title">No Treatment Data</p>
              <p className="empty-state-description text-sm">Add risks to see treatment distribution</p>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Inherent vs Residual</h2>
              <p className="card-description">Average scores by category</p>
            </div>
          </div>
          {inherentVsResidual.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={inherentVsResidual} margin={{ left: 0, right: 10, top: 10, bottom: 0 }}>
                  <XAxis dataKey="category" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} interval={0} angle={-20} textAnchor="end" height={50} />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} domain={[0, 25]} />
                  <Tooltip contentStyle={darkTooltipStyle} />
                  <Bar dataKey="inherent" name="Inherent" fill="#f97316" radius={[4, 4, 0, 0]} maxBarSize={20} />
                  <Bar dataKey="residual" name="Residual" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="empty-state py-8">
              <div className="empty-state-icon">
                <BarChart3 className="h-8 w-8 text-slate-500" />
              </div>
              <p className="empty-state-title">No Score Data</p>
              <p className="empty-state-description text-sm">Risk scores will appear here</p>
            </div>
          )}
          <div className="flex justify-center gap-4 mt-2 pt-3 border-t border-slate-700">
            <div className="flex items-center gap-1.5 text-xs">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: '#f97316' }} />
              <span className="text-slate-400">Inherent</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <div className="w-3 h-3 rounded" style={{ backgroundColor: '#3b82f6' }} />
              <span className="text-slate-400">Residual</span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Risk Velocity Tracker</h2>
              <p className="card-description">Score movement analysis</p>
            </div>
          </div>
          {totalMovement > 0 ? (
            <div className="space-y-5 mt-2">
              <div className="flex items-center gap-4 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                <div className="rounded-lg bg-emerald-500/20 p-3">
                  <ArrowDown className="h-6 w-6 text-emerald-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-slate-400">Improved</p>
                  <p className="text-2xl font-bold text-emerald-400">{riskMovement.improved}</p>
                </div>
                <span className="text-xs text-slate-500">{totalMovement > 0 ? Math.round((riskMovement.improved / totalMovement) * 100) : 0}%</span>
              </div>
              <div className="flex items-center gap-4 p-4 rounded-xl bg-slate-500/10 border border-slate-500/20">
                <div className="rounded-lg bg-slate-500/20 p-3">
                  <Minus className="h-6 w-6 text-slate-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-slate-400">Unchanged</p>
                  <p className="text-2xl font-bold text-slate-300">{riskMovement.unchanged}</p>
                </div>
                <span className="text-xs text-slate-500">{totalMovement > 0 ? Math.round((riskMovement.unchanged / totalMovement) * 100) : 0}%</span>
              </div>
              <div className="flex items-center gap-4 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20">
                <div className="rounded-lg bg-rose-500/20 p-3">
                  <ArrowUp className="h-6 w-6 text-rose-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-slate-400">Worsened</p>
                  <p className="text-2xl font-bold text-rose-400">{riskMovement.worsened}</p>
                </div>
                <span className="text-xs text-slate-500">{totalMovement > 0 ? Math.round((riskMovement.worsened / totalMovement) * 100) : 0}%</span>
              </div>
            </div>
          ) : (
            <div className="empty-state py-8">
              <div className="empty-state-icon">
                <TrendingUp className="h-8 w-8 text-slate-500" />
              </div>
              <p className="empty-state-title">No Movement Data</p>
              <p className="empty-state-description text-sm">Risk score changes will appear here</p>
            </div>
          )}
        </div>
      </div>

      {/* NEW WIDGET ROW: Mitigation Actions Timeline + Incident Severity */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Mitigation Actions Timeline</h2>
              <p className="card-description">Action status breakdown</p>
            </div>
            <Link href="/erm/mitigation-actions" className="btn-ghost btn-sm">
              View All
            </Link>
          </div>
          {mitigationTimelineData.length > 0 ? (
            <>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={mitigationTimelineData} layout="vertical" margin={{ left: 10, right: 20 }}>
                    <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" width={90} tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={darkTooltipStyle} />
                    <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={28}>
                      {mitigationTimelineData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-700">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400">Overall Completion</span>
                  <span className="text-sm font-medium text-white">{mitigationProgress.percentage}%</span>
                </div>
                <div className="h-2 bg-slate-700 rounded-full overflow-hidden mt-2">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all duration-500"
                    style={{ width: `${mitigationProgress.percentage}%` }}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="empty-state py-8">
              <div className="empty-state-icon bg-emerald-500/10">
                <CheckCircle className="h-8 w-8 text-emerald-400" />
              </div>
              <p className="empty-state-title">No Actions Yet</p>
              <p className="empty-state-description text-sm">Mitigation actions will appear here</p>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Incident Severity Breakdown</h2>
              <p className="card-description">Incidents by severity level</p>
            </div>
            <Link href="/erm/incidents" className="btn-ghost btn-sm">
              View All
            </Link>
          </div>
          {incidentSeverity.length > 0 ? (
            <div className="flex items-center gap-6">
              <div className="h-52 flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={incidentSeverity}
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={70}
                      paddingAngle={3}
                      dataKey="value"
                      strokeWidth={0}
                    >
                      {incidentSeverity.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={darkTooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-3 min-w-[140px]">
                {incidentSeverity.map((d, i) => (
                  <div key={i} className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: d.fill }} />
                      <span className="text-sm text-slate-300">{d.name}</span>
                    </div>
                    <span className="text-sm font-bold text-white">{d.value}</span>
                  </div>
                ))}
                <div className="pt-2 border-t border-slate-700">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-400">Total</span>
                    <span className="text-sm font-bold text-white">{incidents?.length || 0}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="empty-state py-8">
              <div className="empty-state-icon">
                <Shield className="h-8 w-8 text-slate-500" />
              </div>
              <p className="empty-state-title">No Incidents</p>
              <p className="empty-state-description text-sm">No incidents have been recorded</p>
            </div>
          )}
        </div>
      </div>

      {/* NEW WIDGET: Top 10 Risks Table */}
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
                  ? 'bg-primary-500 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              By Inherent
            </button>
            <button
              onClick={() => setTopRiskSort('residual')}
              className={`px-3 py-1.5 text-sm rounded-lg transition-all ${
                topRiskSort === 'residual'
                  ? 'bg-primary-500 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
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
                <tr className="border-b border-slate-700">
                  <th className="text-left py-3 px-3 text-slate-400 font-medium">#</th>
                  <th className="text-left py-3 px-3 text-slate-400 font-medium">Risk Title</th>
                  <th className="text-left py-3 px-3 text-slate-400 font-medium">Category</th>
                  <th className="text-center py-3 px-3 text-slate-400 font-medium">Inherent</th>
                  <th className="text-center py-3 px-3 text-slate-400 font-medium">Residual</th>
                  <th className="text-center py-3 px-3 text-slate-400 font-medium">Treatment</th>
                  <th className="text-center py-3 px-3 text-slate-400 font-medium">Trend</th>
                </tr>
              </thead>
              <tbody>
                {topRisks.map((risk: any, idx: number) => {
                  const inherent = risk.inherent_score || 0;
                  const residual = risk.residual_score || inherent;
                  const category = risk.risk_category || 'operational';
                  const treatment = risk.treatment || risk.risk_treatment || 'mitigate';
                  const scoreColor = (score: number) => {
                    if (score >= 20) return 'text-rose-400';
                    if (score >= 12) return 'text-orange-400';
                    if (score >= 6) return 'text-amber-400';
                    return 'text-emerald-400';
                  };
                  const scoreBg = (score: number) => {
                    if (score >= 20) return 'bg-rose-500/10';
                    if (score >= 12) return 'bg-orange-500/10';
                    if (score >= 6) return 'bg-amber-500/10';
                    return 'bg-emerald-500/10';
                  };

                  return (
                    <tr key={risk.id} className="border-b border-slate-700/50 hover:bg-slate-800/50 transition-colors">
                      <td className="py-3 px-3 text-slate-500">{idx + 1}</td>
                      <td className="py-3 px-3">
                        <Link href="/erm/risks" className="text-white hover:text-primary-400 transition-colors font-medium">
                          {risk.name || risk.title}
                        </Link>
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
                          style={{
                            backgroundColor: `${CATEGORY_COLORS[category] || '#6366f1'}15`,
                            color: CATEGORY_COLORS[category] || '#6366f1',
                          }}
                        >
                          {CATEGORY_LABELS[category] || category}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className={`inline-flex items-center justify-center w-10 h-7 rounded-md text-xs font-bold ${scoreBg(inherent)} ${scoreColor(inherent)}`}>
                          {inherent}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className={`inline-flex items-center justify-center w-10 h-7 rounded-md text-xs font-bold ${scoreBg(residual)} ${scoreColor(residual)}`}>
                          {residual}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-slate-700 text-slate-300 capitalize">
                          {treatment}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-center">
                        {residual < inherent ? (
                          <TrendingDown className="h-4 w-4 text-emerald-400 mx-auto" />
                        ) : residual > inherent ? (
                          <TrendingUp className="h-4 w-4 text-rose-400 mx-auto" />
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

      {/* NEW WIDGET ROW: KRI Gauge Panel + Risk Appetite Utilization */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">KRI Gauge Panel</h2>
              <p className="card-description">Current value vs threshold</p>
            </div>
            <Link href="/erm/kris" className="btn-ghost btn-sm">
              View All
            </Link>
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
                const statusBg = status === 'red' ? 'bg-rose-500/10 border-rose-500/20' : status === 'amber' ? 'bg-amber-500/10 border-amber-500/20' : 'bg-emerald-500/10 border-emerald-500/20';

                return (
                  <div key={kri.id} className={`rounded-xl border p-3 ${statusBg}`}>
                    <div className="flex items-center justify-center mb-2">
                      <div className="relative w-16 h-16">
                        <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
                          <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(100,116,139,0.2)" strokeWidth="3" />
                          <circle
                            cx="18" cy="18" r="15.5" fill="none"
                            stroke={statusColor}
                            strokeWidth="3"
                            strokeDasharray={`${pct * 0.975} 97.5`}
                            strokeLinecap="round"
                            className="transition-all duration-700"
                          />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-xs font-bold text-white">{current}</span>
                        </div>
                      </div>
                    </div>
                    <p className="text-xs font-medium text-white text-center truncate">{kri.name}</p>
                    <p className="text-[10px] text-slate-500 text-center mt-0.5">
                      Threshold: {amber}{kri.unit || ''}
                    </p>
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
            <Link href="/erm/appetite" className="btn-ghost btn-sm">
              Manage
            </Link>
          </div>
          {appetiteUtilization.length > 0 ? (
            <div className="space-y-4">
              {appetiteUtilization.map((item, idx) => {
                const barColor = item.status === 'breach' ? 'bg-rose-500' : item.status === 'warning' ? 'bg-amber-500' : 'bg-emerald-500';
                const textColor = item.status === 'breach' ? 'text-rose-400' : item.status === 'warning' ? 'text-amber-400' : 'text-emerald-400';
                return (
                  <div key={idx}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm text-slate-300">{item.category}</span>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-medium ${textColor}`}>
                          {item.current} / {item.threshold}
                        </span>
                        {item.status === 'breach' && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-500/20 text-rose-400">
                            <Zap className="h-3 w-3" /> Breach
                          </span>
                        )}
                        {item.status === 'warning' && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/20 text-amber-400">
                            Warning
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${barColor} rounded-full transition-all duration-500`}
                        style={{ width: `${Math.min(item.utilization, 100)}%` }}
                      />
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
              <p className="empty-state-description text-sm">Configure risk appetite thresholds to track utilization</p>
            </div>
          )}
        </div>
      </div>

      {/* Existing category + score sections */}
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
                    contentStyle={darkTooltipStyle}
                    formatter={(value: number, name: string, props: any) => [
                      <span key="v">{value} risks (Avg: {props.payload.avgScore})</span>,
                      'Count',
                    ]}
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
          
          <div className="mt-4 pt-4 border-t border-slate-700">
            <div className="flex flex-wrap gap-3">
              {categoryData.slice(0, 5).map((cat) => (
                <div key={cat.category} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded" style={{ backgroundColor: cat.color }} />
                  <span className="text-xs text-slate-400">
                    {cat.label}: <span className="text-white font-medium">{cat.count}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
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
                      <span className="text-sm text-slate-300">{item.label}</span>
                      <span className="text-xs text-slate-500">({item.range})</span>
                    </div>
                    <span className="text-sm font-semibold text-white">{item.count}</span>
                  </div>
                  <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full bg-${item.color}-500 rounded-full transition-all duration-500`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          
          <div className="mt-6 pt-4 border-t border-slate-700">
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-3 rounded-lg bg-slate-800/50">
                <p className="text-2xl font-bold text-white">{dashboard?.avg_inherent_score?.toFixed(1) || '0.0'}</p>
                <p className="text-xs text-slate-400">Avg Inherent Score</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-slate-800/50">
                <p className="text-2xl font-bold text-white">{dashboard?.avg_residual_score?.toFixed(1) || '0.0'}</p>
                <p className="text-xs text-slate-400">Avg Residual Score</p>
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
              <p className="font-semibold text-white group-hover:text-primary-300 transition-colors truncate">Risk Register</p>
              <p className="text-xs text-slate-400">Manage all risks</p>
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
              <p className="font-semibold text-white group-hover:text-cyan-300 transition-colors truncate">KRIs</p>
              <p className="text-xs text-slate-400">Monitor indicators</p>
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
              <p className="font-semibold text-white group-hover:text-emerald-300 transition-colors truncate">Mitigations</p>
              <p className="text-xs text-slate-400">Track actions</p>
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
              <p className="font-semibold text-white group-hover:text-purple-300 transition-colors truncate">Reports</p>
              <p className="text-xs text-slate-400">Generate reports</p>
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
              <p className="font-semibold text-white group-hover:text-blue-300 transition-colors truncate">Analytics</p>
              <p className="text-xs text-slate-400">Advanced analysis</p>
            </div>
            <ChevronRight className="h-5 w-5 text-slate-600 group-hover:text-blue-400 transition-colors" />
          </div>
        </Link>
      </div>
    </div>
  );
}
