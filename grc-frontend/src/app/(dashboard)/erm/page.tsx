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

export default function ERMOverviewPage() {
  const [hoveredCell, setHoveredCell] = useState<{ likelihood: number; impact: number } | null>(null);
  const [heatmapType, setHeatmapType] = useState<'inherent' | 'residual'>('inherent');

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
  const recentIncidents = incidents?.slice(0, 5) || [];

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
              <h2 className="card-title">Mitigation Actions</h2>
              <p className="card-description">Pending and overdue actions</p>
            </div>
            <Link href="/erm/mitigation-actions" className="btn-ghost btn-sm">
              View All
            </Link>
          </div>
          
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-slate-400">Overall Progress</span>
              <span className="text-sm font-medium text-white">{mitigationProgress.completed}/{mitigationProgress.total}</span>
            </div>
            <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
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
                    <p className="text-sm font-medium text-white truncate">{action.title}</p>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
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
                  className="flex items-center gap-3 rounded-lg border border-slate-700/50 bg-slate-800/30 p-3 hover:border-slate-600 hover:bg-slate-800/50 transition-all"
                >
                  <div className={`rounded-lg p-2 ${
                    incident.severity === 'critical' ? 'bg-rose-500/20' :
                    incident.severity === 'high' ? 'bg-orange-500/20' :
                    incident.severity === 'medium' ? 'bg-amber-500/20' : 'bg-slate-700/50'
                  }`}>
                    <AlertCircle className={`h-4 w-4 ${
                      incident.severity === 'critical' ? 'text-rose-400' :
                      incident.severity === 'high' ? 'text-orange-400' :
                      incident.severity === 'medium' ? 'text-amber-400' : 'text-slate-400'
                    }`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{incident.title}</p>
                    <p className="text-xs text-slate-400">
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

      <div className="grid gap-4 md:grid-cols-4">
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
              <p className="text-xs text-slate-400">Analytics</p>
            </div>
            <ChevronRight className="h-5 w-5 text-slate-600 group-hover:text-purple-400 transition-colors" />
          </div>
        </Link>
      </div>
    </div>
  );
}
