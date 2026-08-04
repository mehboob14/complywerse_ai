'use client';

import { useQuery } from '@tanstack/react-query';
import { enrichedDashboardApi } from '@/lib/api';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
  LineChart, Line, Legend,
  BarChart, Bar,
} from 'recharts';
import { Target, Zap, TrendingDown, BarChart3 } from 'lucide-react';

const STRATEGY_COLORS: Record<string, string> = {
  avoid: '#ef4444',
  reduce: '#3b82f6',
  transfer: '#f59e0b',
  accept: '#10b981',
};

const STATUS_COLORS: Record<string, string> = {
  completed: '#10b981',
  in_progress: '#3b82f6',
  overdue: '#ef4444',
  not_started: '#64748b',
};

const tooltipStyle = {
  backgroundColor: '#1e293b',
  border: '1px solid #334155',
  borderRadius: '8px',
  color: '#fff',
  fontSize: '12px',
};

export default function RiskTreatmentTab() {
  const { data: effectivenessData, isLoading: loadingEffectiveness } = useQuery({
    queryKey: ['treatment-effectiveness'],
    queryFn: async () => {
      const res = await enrichedDashboardApi.getTreatmentEffectiveness();
      return res.data;
    },
  });

  const { data: strategyMixData, isLoading: loadingStrategyMix } = useQuery({
    queryKey: ['treatment-strategy-mix'],
    queryFn: async () => {
      const res = await enrichedDashboardApi.getTreatmentStrategyMix();
      return res.data;
    },
  });

  const { data: velocityData, isLoading: loadingVelocity } = useQuery({
    queryKey: ['treatment-action-velocity'],
    queryFn: async () => {
      const res = await enrichedDashboardApi.getTreatmentActionVelocity();
      return res.data;
    },
  });

  const { data: burndownData, isLoading: loadingBurndown } = useQuery({
    queryKey: ['treatment-burndown'],
    queryFn: async () => {
      const res = await enrichedDashboardApi.getTreatmentBurndown();
      return res.data;
    },
  });

  const isLoading = loadingEffectiveness || loadingStrategyMix || loadingVelocity || loadingBurndown;

  if (isLoading) {
    return (
      <div className="space-y-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-slate-700 bg-slate-800 p-6 animate-pulse">
            <div className="h-4 w-48 bg-slate-700 rounded mb-4" />
            <div className="h-64 bg-slate-700/50 rounded" />
          </div>
        ))}
      </div>
    );
  }

  const scatterPoints = effectivenessData?.scatter_data || effectivenessData?.actions || (Array.isArray(effectivenessData) ? effectivenessData : []);

  const STRATEGY_PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#64748b'];
  const strategyPieData = (() => {
    if (!strategyMixData) return [];
    const strategies = strategyMixData.risk_treatment_strategies || [];
    if (Array.isArray(strategies) && strategies.length > 0) {
      return strategies.slice(0, 8).map((s: any, i: number) => ({
        name: String(s.strategy || 'Unknown').substring(0, 40),
        value: s.count || 0,
        color: STRATEGY_PIE_COLORS[i % STRATEGY_PIE_COLORS.length],
      })).filter((d: any) => d.value > 0);
    }
    return Object.entries(strategyMixData)
      .filter(([key]) => ['avoid', 'reduce', 'transfer', 'accept'].includes(key))
      .map(([key, value]: [string, any]) => ({
        name: key.charAt(0).toUpperCase() + key.slice(1),
        value: typeof value === 'number' ? value : 0,
        color: STRATEGY_COLORS[key] || '#94a3b8',
      })).filter((d) => d.value > 0);
  })();

  const strategyTotal = strategyPieData.reduce((sum, d) => sum + d.value, 0);

  const burndownChartData = burndownData?.burndown || burndownData?.months || (Array.isArray(burndownData) ? burndownData : []);

  const statusBreakdown = velocityData?.by_status
    ? Object.entries(velocityData.by_status).map(([key, value]) => ({
        name: key.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
        value: typeof value === 'number' ? value : 0,
        fill: STATUS_COLORS[key] || '#94a3b8',
      }))
    : [];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="rounded-lg bg-blue-500/20 p-2">
              <Zap className="h-4 w-4 text-blue-400" />
            </div>
            <span className="text-sm text-slate-400">Avg Completion Days</span>
          </div>
          <p className="text-3xl font-bold text-white">
            {velocityData?.avg_completion_days != null
              ? Math.round(velocityData.avg_completion_days)
              : '—'}
          </p>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="rounded-lg bg-red-500/20 p-2">
              <TrendingDown className="h-4 w-4 text-red-400" />
            </div>
            <span className="text-sm text-slate-400">Overdue Actions</span>
          </div>
          <p className="text-3xl font-bold text-red-400">
            {velocityData?.overdue_actions ?? velocityData?.overdue ?? '—'}
          </p>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="rounded-lg bg-emerald-500/20 p-2">
              <Target className="h-4 w-4 text-emerald-400" />
            </div>
            <span className="text-sm text-slate-400">On Track</span>
          </div>
          <p className="text-3xl font-bold text-emerald-400">
            {velocityData?.on_track_actions ?? velocityData?.on_track ?? '—'}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
          <div className="flex items-center gap-3 border-b border-slate-700 px-5 py-4">
            <div className="rounded-lg bg-purple-500/20 p-2">
              <Target className="h-4 w-4 text-purple-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">Treatment Effectiveness</h3>
          </div>
          <div className="p-5">
            {scatterPoints.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis
                    type="number"
                    dataKey="expected_reduction"
                    name="Expected Reduction"
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    axisLine={{ stroke: '#334155' }}
                    label={{ value: 'Expected %', position: 'insideBottom', offset: -5, fill: '#94a3b8', fontSize: 11 }}
                  />
                  <YAxis
                    type="number"
                    dataKey="actual_reduction"
                    name="Actual Reduction"
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    axisLine={{ stroke: '#334155' }}
                    label={{ value: 'Actual %', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 11 }}
                  />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ strokeDasharray: '3 3' }} />
                  <Scatter data={scatterPoints} fill="#8b5cf6" />
                </ScatterChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex flex-col items-center justify-center h-64 text-slate-500">
                <Target className="h-8 w-8 mb-2" />
                <p className="text-sm">No effectiveness data available</p>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
          <div className="flex items-center gap-3 border-b border-slate-700 px-5 py-4">
            <div className="rounded-lg bg-amber-500/20 p-2">
              <BarChart3 className="h-4 w-4 text-amber-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">Strategy Mix</h3>
          </div>
          <div className="p-5 flex flex-col items-center">
            {strategyPieData.length > 0 ? (
              <>
                <div className="relative">
                  <ResponsiveContainer width={200} height={200}>
                    <PieChart>
                      <Pie
                        data={strategyPieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={90}
                        dataKey="value"
                        strokeWidth={0}
                      >
                        {strategyPieData.map((entry, index) => (
                          <Cell key={index} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-bold text-white">{strategyTotal}</span>
                    <span className="text-xs text-slate-400">Total</span>
                  </div>
                </div>
                <div className="flex flex-wrap justify-center gap-3 mt-3">
                  {strategyPieData.map((d, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-xs">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                      <span className="text-slate-400">{d.name}</span>
                      <span className="text-white font-medium">{d.value}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-64 text-slate-500">
                <BarChart3 className="h-8 w-8 mb-2" />
                <p className="text-sm">No strategy mix data available</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
        <div className="flex items-center gap-3 border-b border-slate-700 px-5 py-4">
          <div className="rounded-lg bg-cyan-500/20 p-2">
            <TrendingDown className="h-4 w-4 text-cyan-400" />
          </div>
          <h3 className="text-sm font-semibold text-white">Treatment Burndown</h3>
        </div>
        <div className="p-5">
          {burndownChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={burndownChartData} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="month"
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  axisLine={{ stroke: '#334155' }}
                />
                <YAxis
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  axisLine={{ stroke: '#334155' }}
                />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ color: '#94a3b8', fontSize: '12px' }} />
                <Line
                  type="monotone"
                  dataKey="remaining"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={{ fill: '#f59e0b', r: 3 }}
                  name="Remaining"
                />
                <Line
                  type="monotone"
                  dataKey="completed_cumulative"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={{ fill: '#10b981', r: 3 }}
                  name="Completed (Cumulative)"
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-slate-500">
              <TrendingDown className="h-8 w-8 mb-2" />
              <p className="text-sm">No burndown data available</p>
            </div>
          )}
        </div>
      </div>

      {statusBreakdown.length > 0 && (
        <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
          <div className="flex items-center gap-3 border-b border-slate-700 px-5 py-4">
            <div className="rounded-lg bg-indigo-500/20 p-2">
              <BarChart3 className="h-4 w-4 text-indigo-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">Action Status Breakdown</h3>
          </div>
          <div className="p-5">
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={statusBreakdown} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="name"
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  axisLine={{ stroke: '#334155' }}
                />
                <YAxis
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  axisLine={{ stroke: '#334155' }}
                />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="value" name="Actions" radius={[4, 4, 0, 0]}>
                  {statusBreakdown.map((entry, index) => (
                    <Cell key={index} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
