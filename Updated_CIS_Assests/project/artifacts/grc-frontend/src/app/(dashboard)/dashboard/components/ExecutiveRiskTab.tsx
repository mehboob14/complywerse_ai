'use client';

import { useQuery } from '@tanstack/react-query';
import { enrichedDashboardApi } from '@/lib/api';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell,
  BarChart, Bar,
} from 'recharts';
import {
  TrendingUp, AlertTriangle, Shield, Target, BarChart3, ClipboardCheck, Activity,
} from 'lucide-react';

const COLORS = ['#3b82f6', '#f59e0b', '#ef4444', '#10b981', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-700 bg-slate-800 p-5 animate-pulse ${className}`}>
      <div className="h-4 w-1/3 bg-slate-700 rounded mb-4" />
      <div className="h-40 bg-slate-700/50 rounded" />
    </div>
  );
}

export default function ExecutiveRiskTab() {
  const { data: velocityRes, isLoading: velocityLoading } = useQuery({
    queryKey: ['exec-risk-velocity'],
    queryFn: () => enrichedDashboardApi.getExecutiveRiskVelocity(90),
  });

  const { data: appetiteRes, isLoading: appetiteLoading } = useQuery({
    queryKey: ['exec-risk-appetite'],
    queryFn: () => enrichedDashboardApi.getExecutiveRiskAppetiteGauge(),
  });

  const { data: emergingRes, isLoading: emergingLoading } = useQuery({
    queryKey: ['exec-emerging-risks'],
    queryFn: () => enrichedDashboardApi.getExecutiveEmergingRisks(),
  });

  const { data: concentrationRes, isLoading: concentrationLoading } = useQuery({
    queryKey: ['exec-risk-concentration'],
    queryFn: () => enrichedDashboardApi.getExecutiveRiskConcentration(),
  });

  const { data: boardRes, isLoading: boardLoading } = useQuery({
    queryKey: ['exec-board-readiness'],
    queryFn: () => enrichedDashboardApi.getExecutiveBoardReadiness(),
  });

  const { data: summaryRes, isLoading: summaryLoading } = useQuery({
    queryKey: ['exec-summary'],
    queryFn: () => enrichedDashboardApi.getExecutiveSummary(),
  });

  const velocity = velocityRes?.data;
  const appetite = appetiteRes?.data;
  const emerging = emergingRes?.data;
  const concentration = concentrationRes?.data;
  const board = boardRes?.data;
  const summary = summaryRes?.data;

  const tooltipStyle = {
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '12px',
  };

  return (
    <div className="space-y-6">
      {summaryLoading ? (
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-xl border border-slate-700 bg-slate-800 p-5 animate-pulse">
              <div className="h-3 w-20 bg-slate-700 rounded mb-3" />
              <div className="h-8 w-16 bg-slate-700 rounded" />
            </div>
          ))}
        </div>
      ) : summary ? (
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Total Risks', value: summary.total_risks ?? 0, icon: AlertTriangle, color: 'text-blue-400', bg: 'bg-blue-500/20' },
            { label: 'Critical Risks', value: summary.critical_risks ?? 0, icon: Shield, color: 'text-red-400', bg: 'bg-red-500/20' },
            { label: 'Risk Reduction', value: `${summary.risk_reduction_pct ?? 0}%`, icon: TrendingUp, color: 'text-emerald-400', bg: 'bg-emerald-500/20' },
            { label: 'Avg Risk Score', value: summary.avg_risk_score?.toFixed(1) ?? '0', icon: Target, color: 'text-amber-400', bg: 'bg-amber-500/20' },
          ].map((stat, idx) => (
            <div key={idx} className="rounded-xl border border-slate-700 bg-slate-800 p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className={`rounded-lg p-2 ${stat.bg}`}>
                  <stat.icon className={`h-4 w-4 ${stat.color}`} />
                </div>
                <span className="text-xs font-medium text-slate-400">{stat.label}</span>
              </div>
              <p className="text-2xl font-bold text-white">{stat.value}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {velocityLoading ? (
            <SkeletonCard className="h-full" />
          ) : (
            <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden h-full">
              <div className="flex items-center gap-3 border-b border-slate-700 px-5 py-4">
                <div className="rounded-lg bg-purple-500/20 p-2">
                  <TrendingUp className="h-4 w-4 text-purple-400" />
                </div>
                <h3 className="text-sm font-semibold text-white">Risk Velocity (90 Days)</h3>
              </div>
              <div className="p-5">
                {Array.isArray(velocity) && velocity.length > 0 ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={velocity}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={{ stroke: '#334155' }} />
                      <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={{ stroke: '#334155' }} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Legend wrapperStyle={{ color: '#94a3b8', fontSize: '12px' }} />
                      <Line type="monotone" dataKey="avg_inherent" stroke="#f59e0b" strokeWidth={2} dot={false} name="Avg Inherent" />
                      <Line type="monotone" dataKey="avg_residual" stroke="#3b82f6" strokeWidth={2} dot={false} name="Avg Residual" />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex flex-col items-center justify-center h-60 text-slate-500">
                    <TrendingUp className="h-8 w-8 mb-2" />
                    <p className="text-sm">No velocity data available</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div>
          {boardLoading ? (
            <SkeletonCard className="h-full" />
          ) : (
            <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden h-full">
              <div className="flex items-center gap-3 border-b border-slate-700 px-5 py-4">
                <div className="rounded-lg bg-cyan-500/20 p-2">
                  <ClipboardCheck className="h-4 w-4 text-cyan-400" />
                </div>
                <h3 className="text-sm font-semibold text-white">Board Readiness</h3>
              </div>
              <div className="p-5 flex flex-col items-center justify-center">
                {board ? (() => {
                  const score = board.score ?? board.readiness_score ?? 0;
                  const color = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444';
                  return (
                    <>
                      <div className="relative w-32 h-32">
                        <svg viewBox="0 0 36 36" className="w-32 h-32 transform -rotate-90">
                          <circle cx="18" cy="18" r="15.5" fill="none" stroke="#334155" strokeWidth="3" />
                          <circle cx="18" cy="18" r="15.5" fill="none" stroke={color} strokeWidth="3" strokeDasharray={`${score * 0.974} 100`} strokeLinecap="round" />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className="text-3xl font-bold text-white">{score}</span>
                          <span className="text-xs text-slate-400">/ 100</span>
                        </div>
                      </div>
                      <p className="text-sm text-slate-300 mt-4 font-medium">
                        {score >= 80 ? 'Board Ready' : score >= 60 ? 'Needs Improvement' : 'Not Ready'}
                      </p>
                      {board.last_updated && (
                        <p className="text-xs text-slate-500 mt-1">Last updated: {new Date(board.last_updated).toLocaleDateString()}</p>
                      )}
                    </>
                  );
                })() : (
                  <div className="flex flex-col items-center justify-center h-40 text-slate-500">
                    <ClipboardCheck className="h-8 w-8 mb-2" />
                    <p className="text-sm">No readiness data</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          {appetiteLoading ? (
            <SkeletonCard />
          ) : (
            <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
              <div className="flex items-center gap-3 border-b border-slate-700 px-5 py-4">
                <div className="rounded-lg bg-amber-500/20 p-2">
                  <BarChart3 className="h-4 w-4 text-amber-400" />
                </div>
                <h3 className="text-sm font-semibold text-white">Risk Appetite Gauges</h3>
              </div>
              <div className="p-5">
                {Array.isArray(appetite) && appetite.length > 0 ? (
                  <div className="grid grid-cols-2 gap-4">
                    {appetite.map((gauge: any, idx: number) => {
                      const pct = gauge.utilization_pct ?? 0;
                      const breached = gauge.breached ?? pct > 100;
                      const color = breached ? '#ef4444' : pct > 80 ? '#f59e0b' : '#10b981';
                      return (
                        <div key={idx} className="flex flex-col items-center p-4 rounded-xl bg-slate-900/50 border border-slate-700">
                          <div className="relative w-16 h-16">
                            <svg viewBox="0 0 36 36" className="w-16 h-16 transform -rotate-90">
                              <circle cx="18" cy="18" r="15.5" fill="none" stroke="#334155" strokeWidth="3" />
                              <circle cx="18" cy="18" r="15.5" fill="none" stroke={color} strokeWidth="3" strokeDasharray={`${Math.min(pct, 100) * 0.974} 100`} strokeLinecap="round" />
                            </svg>
                            <div className="absolute inset-0 flex items-center justify-center">
                              <span className="text-xs font-bold text-white">{Math.round(pct)}%</span>
                            </div>
                          </div>
                          <span className="text-xs font-medium text-slate-300 mt-2 text-center">{gauge.category ?? gauge.name ?? `Category ${idx + 1}`}</span>
                          {breached && (
                            <span className="text-[10px] text-red-400 mt-1 font-medium">BREACHED</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-40 text-slate-500">
                    <BarChart3 className="h-8 w-8 mb-2" />
                    <p className="text-sm">No appetite data available</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div>
          {concentrationLoading ? (
            <SkeletonCard />
          ) : (
            <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
              <div className="flex items-center gap-3 border-b border-slate-700 px-5 py-4">
                <div className="rounded-lg bg-blue-500/20 p-2">
                  <Activity className="h-4 w-4 text-blue-400" />
                </div>
                <h3 className="text-sm font-semibold text-white">Risk Concentration</h3>
              </div>
              <div className="p-5 flex flex-col items-center">
                {Array.isArray(concentration) && concentration.length > 0 ? (() => {
                  const chartData = concentration.map((item: any, idx: number) => ({
                    name: item.category ?? item.name ?? `Cat ${idx + 1}`,
                    value: item.count ?? item.value ?? 0,
                  }));
                  const total = chartData.reduce((sum: number, d: any) => sum + d.value, 0);
                  return (
                    <>
                      <div className="relative">
                        <ResponsiveContainer width={200} height={200}>
                          <PieChart>
                            <Pie data={chartData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} dataKey="value" strokeWidth={0}>
                              {chartData.map((_: any, index: number) => (
                                <Cell key={index} fill={COLORS[index % COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip contentStyle={tooltipStyle} />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className="text-2xl font-bold text-white">{total}</span>
                          <span className="text-xs text-slate-400">Total</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap justify-center gap-3 mt-3">
                        {chartData.map((d: any, i: number) => (
                          <div key={i} className="flex items-center gap-1.5 text-xs">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                            <span className="text-slate-400">{d.name}</span>
                            <span className="text-white font-medium">{d.value}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  );
                })() : (
                  <div className="flex flex-col items-center justify-center h-40 text-slate-500">
                    <Activity className="h-8 w-8 mb-2" />
                    <p className="text-sm">No concentration data</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {emergingLoading ? (
        <SkeletonCard />
      ) : (
        <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
          <div className="flex items-center gap-3 border-b border-slate-700 px-5 py-4">
            <div className="rounded-lg bg-red-500/20 p-2">
              <AlertTriangle className="h-4 w-4 text-red-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">Top Emerging Risks</h3>
          </div>
          <div className="p-4">
            {Array.isArray(emerging) && emerging.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-400 text-xs border-b border-slate-700">
                      <th className="text-left py-2 px-3 font-medium">#</th>
                      <th className="text-left py-2 px-3 font-medium">Risk</th>
                      <th className="text-left py-2 px-3 font-medium">Category</th>
                      <th className="text-center py-2 px-3 font-medium">Score</th>
                      <th className="text-center py-2 px-3 font-medium">90d Change</th>
                      <th className="text-center py-2 px-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {emerging.slice(0, 10).map((risk: any, idx: number) => {
                      const change = risk.score_change_90d ?? 0;
                      return (
                        <tr key={idx} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                          <td className="py-2.5 px-3 text-slate-500">{idx + 1}</td>
                          <td className="py-2.5 px-3 text-slate-300">{risk.title ?? risk.name ?? `Risk ${idx + 1}`}</td>
                          <td className="py-2.5 px-3 text-slate-400">{risk.category ?? '-'}</td>
                          <td className="py-2.5 px-3 text-center font-semibold text-white">{risk.score ?? risk.risk_score ?? '-'}</td>
                          <td className="py-2.5 px-3 text-center">
                            <span className={`text-xs font-medium ${change > 0 ? 'text-red-400' : change < 0 ? 'text-emerald-400' : 'text-slate-400'}`}>
                              {change > 0 ? '+' : ''}{change}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <span className={`text-xs px-2 py-0.5 rounded ${
                              (risk.status === 'critical' || risk.severity === 'critical') ? 'bg-red-500/20 text-red-400' :
                              (risk.status === 'high' || risk.severity === 'high') ? 'bg-orange-500/20 text-orange-400' :
                              'bg-yellow-500/20 text-yellow-400'
                            }`}>
                              {risk.status ?? risk.severity ?? 'emerging'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-40 text-slate-500">
                <AlertTriangle className="h-8 w-8 mb-2" />
                <p className="text-sm">No emerging risks data</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
