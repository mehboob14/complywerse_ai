'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { isProjectsApi } from '@/lib/api';
import {
  PieChart as RPieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Loader2,
  AlertCircle,
  FolderKanban,
  TrendingUp,
  DollarSign,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  Target,
  PieChart,
  Users,
  Shield,
  Flame,
} from 'lucide-react';

// Categorical data-viz palette for the status/category charts — leads with the
// teal brand color, remaining hues kept distinct so multiple series stay legible.
const COLORS = ['#1ed4b0', '#10b981', '#f59e0b', '#f43f5e', '#0ea5e9', '#f97316', '#14b8a6', '#64748b'];

export default function PortfolioDashboardPage() {
  const router = useRouter();

  const { data, isLoading, error } = useQuery({
    queryKey: ['is-projects-dashboard'],
    queryFn: async () => {
      const res = await isProjectsApi.getDashboard();
      return res.data;
    },
  });

  const { data: enhanced } = useQuery({
    queryKey: ['is-projects-enhanced-analytics'],
    queryFn: async () => {
      const res = await isProjectsApi.getEnhancedAnalytics();
      return res.data;
    },
  });

  const { data: healthTrend } = useQuery({
    queryKey: ['is-projects-health-trend'],
    queryFn: async () => {
      const res = await isProjectsApi.getHealthTrend();
      return res.data;
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-primary-600" size={32} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 p-4 bg-rose-50 border border-rose-200 rounded-lg text-rose-700">
        <AlertCircle size={16} /> Failed to load dashboard
      </div>
    );
  }

  const statusDist: { name: string; value: number }[] = data?.status_distribution || [];
  const categoryDist: { name: string; value: number }[] = data?.category_distribution || [];
  const healthCounts = data?.health_counts || { 'On Track': 0, 'At Risk': 0, 'Off Track': 0 };
  const budget = data?.budget || { total_estimated: 0, total_actual: 0, utilization: 0 };
  const upcomingMilestones = data?.upcoming_milestones || [];
  const overdueMilestones = data?.overdue_milestones || [];
  const totalProjects = data?.total_projects || 0;

  const totalStatusCount = statusDist.reduce((a, b) => a + b.value, 0);
  const totalCategoryCount = categoryDist.reduce((a, b) => a + b.value, 0);
  const maxCategoryVal = Math.max(...categoryDist.map(c => c.value), 1);

  const formatCurrency = (n: number) => {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
    return `$${n.toFixed(0)}`;
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <div className="space-y-4 sm:space-y-6 text-[var(--color-text)]">
      <div className="min-w-0">
        <h1 className="text-lg sm:text-xl font-semibold text-slate-900 tracking-tight">Overview</h1>
        <p className="mt-1 text-sm text-slate-600">Executive overview of all information security projects</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <div className="cw-card p-4">
          <div className="flex items-center gap-2 text-[var(--color-muted)] mb-2">
            <FolderKanban size={16} />
            <span className="text-xs font-medium">Total Projects</span>
          </div>
          <p className="text-2xl font-bold text-[var(--color-text)]">{totalProjects}</p>
        </div>
        <div className="cw-card p-4">
          <div className="flex items-center gap-2 text-emerald-600 mb-2">
            <CheckCircle2 size={16} />
            <span className="text-xs font-medium">On Track</span>
          </div>
          <p className="text-2xl font-bold text-emerald-600">{healthCounts['On Track']}</p>
        </div>
        <div className="cw-card p-4">
          <div className="flex items-center gap-2 text-amber-600 mb-2">
            <AlertTriangle size={16} />
            <span className="text-xs font-medium">At Risk</span>
          </div>
          <p className="text-2xl font-bold text-amber-600">{healthCounts['At Risk']}</p>
        </div>
        <div className="cw-card p-4">
          <div className="flex items-center gap-2 text-rose-600 mb-2">
            <Target size={16} />
            <span className="text-xs font-medium">Off Track</span>
          </div>
          <p className="text-2xl font-bold text-rose-600">{healthCounts['Off Track']}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        <div className="cw-card p-5">
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2"><PieChart size={16} /> Projects by Status</h3>
          {statusDist.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)] text-center py-8">No data</p>
          ) : (
            <div className="flex items-center gap-4">
              <div className="relative h-[140px] w-[140px] flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <RPieChart>
                    <Pie data={statusDist} cx="50%" cy="50%" innerRadius={40} outerRadius={64} dataKey="value" paddingAngle={2}>
                      {statusDist.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => [`${v} project${Number(v) === 1 ? '' : 's'}`, 'Count']} />
                  </RPieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-xl font-bold text-[var(--color-text)]">{totalStatusCount}</span>
                  <span className="text-[10px] text-[var(--color-muted)]">total</span>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 min-w-0 flex-1">
                {statusDist.map((item, i) => (
                  <div key={item.name} className="flex items-center gap-2 text-xs">
                    <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                    <span className="text-[var(--color-muted)] truncate">{item.name}</span>
                    <span className="font-semibold text-[var(--color-text)] ml-auto">{item.value}</span>
                    <span className="text-[10px] text-[var(--color-muted)] w-9 text-right">{totalStatusCount > 0 ? Math.round(item.value / totalStatusCount * 100) : 0}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="cw-card p-5">
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2"><TrendingUp size={16} /> Projects by Category</h3>
          {categoryDist.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)] text-center py-8">No data</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(140, categoryDist.length * 28)}>
              <BarChart data={categoryDist} layout="vertical" margin={{ left: 0, right: 12, top: 4, bottom: 4 }}>
                <XAxis type="number" hide domain={[0, maxCategoryVal]} />
                <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11, fill: 'var(--color-muted)' }} />
                <Tooltip formatter={(v) => [`${v} project${Number(v) === 1 ? '' : 's'}`, 'Count']} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {categoryDist.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="cw-card p-5">
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2"><DollarSign size={16} /> Budget Utilization</h3>
          <div className="text-center py-4">
            <p className="text-3xl font-bold text-[var(--color-text)]">{budget.utilization}%</p>
            <p className="text-xs text-[var(--color-muted)] mt-1">of total budget used</p>
            <div className="cw-progress-track w-full rounded-full h-3 mt-4">
              <div className={`h-3 rounded-full transition-all ${budget.utilization > 90 ? 'bg-rose-500' : budget.utilization > 70 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(budget.utilization, 100)}%` }} />
            </div>
            <div className="flex justify-between mt-3 text-xs text-[var(--color-muted)]">
              <span>Actual: {formatCurrency(budget.total_actual)}</span>
              <span>Estimated: {formatCurrency(budget.total_estimated)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="cw-card p-5">
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
            <Calendar size={16} /> Upcoming Milestones
          </h3>
          {upcomingMilestones.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)] text-center py-6">No upcoming milestones</p>
          ) : (
            <div className="space-y-3">
              {upcomingMilestones.map((m: { id: number; name: string; project_name: string; project_id: number; target_date: string }) => (
                <div
                  key={m.id}
                  onClick={() => router.push(`/is-projects/${m.project_id}`)}
                  className="flex items-center gap-3 p-3 rounded-lg hover:bg-[var(--color-subtle)] cursor-pointer transition-colors"
                >
                  <div className="w-8 h-8 rounded-lg bg-primary-50 flex items-center justify-center flex-shrink-0">
                    <Clock size={14} className="text-primary-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--color-text)] truncate">{m.name}</p>
                    <p className="text-xs text-[var(--color-muted)]">{m.project_name}</p>
                  </div>
                  <span className="text-xs text-[var(--color-muted)] flex-shrink-0">{formatDate(m.target_date)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="cw-card p-5">
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2 text-rose-600">
            <AlertTriangle size={16} /> Overdue Milestones
          </h3>
          {overdueMilestones.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)] text-center py-6">No overdue milestones</p>
          ) : (
            <div className="space-y-3">
              {overdueMilestones.map((m: { id: number; name: string; project_name: string; project_id: number; target_date: string }) => (
                <div
                  key={m.id}
                  onClick={() => router.push(`/is-projects/${m.project_id}`)}
                  className="flex items-center gap-3 p-3 rounded-lg hover:bg-rose-50 cursor-pointer transition-colors border border-rose-100"
                >
                  <div className="w-8 h-8 rounded-lg bg-rose-50 flex items-center justify-center flex-shrink-0">
                    <AlertTriangle size={14} className="text-rose-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--color-text)] truncate">{m.name}</p>
                    <p className="text-xs text-[var(--color-muted)]">{m.project_name}</p>
                  </div>
                  <span className="text-xs text-rose-600 flex-shrink-0">Due {formatDate(m.target_date)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {enhanced && (
        <>
          <div className="cw-card p-5">
            <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2"><TrendingUp size={16} className="text-primary-600" /> Project Health Trend</h3>
            {(() => {
              const hd = (enhanced.health_distribution || {}) as Record<string, number>;
              const total = Object.values(hd).reduce((a: number, b: number) => a + b, 0) || 1;
              const healthColors: Record<string, { bar: string; bg: string; text: string }> = {
                'On Track': { bar: 'bg-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-700' },
                'At Risk': { bar: 'bg-amber-500', bg: 'bg-amber-50', text: 'text-amber-700' },
                'Off Track': { bar: 'bg-rose-500', bg: 'bg-rose-50', text: 'text-rose-700' },
              };
              const healthScore = Math.round(((hd['On Track'] || 0) / total) * 100);
              const trend = (healthTrend?.trend || []) as Array<{date: string; on_track: number; at_risk: number; off_track: number; total: number; health_score: number}>;
              const maxTotal = Math.max(...trend.map(t => t.total), 1);
              return (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs text-[var(--color-muted)]">Health Score</span>
                      <span className={`text-2xl font-bold ${healthScore >= 70 ? 'text-emerald-600' : healthScore >= 40 ? 'text-amber-600' : 'text-rose-600'}`}>{healthScore}%</span>
                    </div>
                    <div className="h-4 rounded-full overflow-hidden flex cw-progress-track">
                      {['On Track', 'At Risk', 'Off Track'].map(h => hd[h] ? (
                        <div key={h} className={`${healthColors[h]?.bar} h-full`} style={{ width: `${(hd[h] / total) * 100}%` }} title={`${h}: ${hd[h]}`} />
                      ) : null)}
                    </div>
                    <div className="flex gap-3 mt-3">
                      {['On Track', 'At Risk', 'Off Track'].map(h => (
                        <div key={h} className={`flex-1 ${healthColors[h]?.bg} rounded-lg p-2 text-center`}>
                          <p className={`text-lg font-bold ${healthColors[h]?.text}`}>{hd[h] || 0}</p>
                          <p className="text-xs text-[var(--color-muted)]">{h}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-xs text-[var(--color-muted)] mb-2">Health Score Over Time {trend.length > 1 && <span className="text-[var(--color-muted)]">({trend.length} snapshots)</span>}</p>
                    {trend.length <= 1 ? (
                      <div className="flex items-center justify-center h-32 text-xs text-[var(--color-muted)] bg-[var(--color-subtle)] rounded-lg">
                        Health trend data will populate as daily snapshots are captured
                      </div>
                    ) : (
                      <div className="relative h-32">
                        <div className="absolute inset-0 flex items-end">
                          {trend.map((point, i) => {
                            const barWidth = Math.max(8, Math.floor(100 / trend.length));
                            return (
                              <div key={i} className="flex-1 flex flex-col items-center justify-end h-full px-px" title={`${point.date}: Score ${point.health_score}%`}>
                                <div className="w-full flex flex-col justify-end" style={{ height: '100%' }}>
                                  <div className="bg-emerald-500 rounded-t-sm" style={{ height: `${(point.on_track / maxTotal) * 100}%`, minHeight: point.on_track ? '2px' : '0' }} />
                                  <div className="bg-amber-500" style={{ height: `${(point.at_risk / maxTotal) * 100}%`, minHeight: point.at_risk ? '2px' : '0' }} />
                                  <div className="bg-rose-500 rounded-b-sm" style={{ height: `${(point.off_track / maxTotal) * 100}%`, minHeight: point.off_track ? '2px' : '0' }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div className="absolute bottom-0 left-0 right-0 flex justify-between text-[10px] text-[var(--color-muted)] mt-1" style={{ transform: 'translateY(100%)' }}>
                          <span>{trend[0]?.date?.slice(5)}</span>
                          <span>{trend[trend.length - 1]?.date?.slice(5)}</span>
                        </div>
                      </div>
                    )}
                    <div className="flex items-center gap-4 mt-4 text-xs text-[var(--color-muted)]">
                      <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-emerald-500 rounded-sm inline-block" /> On Track</span>
                      <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-amber-500 rounded-sm inline-block" /> At Risk</span>
                      <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-rose-500 rounded-sm inline-block" /> Off Track</span>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            <div className="cw-card p-5">
              <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2"><Flame size={16} className="text-primary-600" /> Budget Burn Rate</h3>
              {(enhanced.budget_overview || []).length === 0 ? (
                <p className="text-sm text-[var(--color-muted)] text-center py-6">No budget data</p>
              ) : (
                <div className="space-y-3">
                  {(enhanced.budget_overview as Array<{project_id: number; project_name: string; burn_rate_pct: number; budget_estimated: number; budget_actual: number; status: string}>).slice(0, 8).map((item) => (
                    <div key={item.project_id} className="cursor-pointer hover:bg-[var(--color-subtle)] rounded-lg p-2 -mx-2 transition-colors" onClick={() => router.push(`/is-projects/${item.project_id}`)}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-[var(--color-text)] truncate flex-1">{item.project_name}</span>
                        <span className={`text-xs font-medium ${item.burn_rate_pct > 100 ? 'text-rose-600' : item.burn_rate_pct > 80 ? 'text-amber-600' : 'text-emerald-600'}`}>{item.burn_rate_pct}%</span>
                      </div>
                      <div className="cw-progress-track w-full rounded-full h-1.5">
                        <div className={`h-1.5 rounded-full transition-all ${item.burn_rate_pct > 100 ? 'bg-rose-500' : item.burn_rate_pct > 80 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(item.burn_rate_pct, 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="cw-card p-5">
              <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2"><Users size={16} className="text-primary-600" /> Resource Utilization Heatmap</h3>
              {(enhanced.team_utilization || []).length === 0 ? (
                <p className="text-sm text-[var(--color-muted)] text-center py-6">No team data</p>
              ) : (() => {
                const members = (enhanced.team_utilization as Array<{name: string; total_projects: number; projects: Array<{project_name: string; role: string}>}>).slice(0, 10);
                const allProjects = Array.from(new Set(members.flatMap(m => m.projects.map(p => p.project_name)))).slice(0, 6);
                return (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr>
                          <th className="text-left py-1 px-1 text-[var(--color-muted)] font-medium sticky left-0 bg-[var(--color-surface)]">Member</th>
                          {allProjects.map(p => (
                            <th key={p} className="py-1 px-1 text-center text-[var(--color-muted)] font-medium" title={p}>
                              <span className="block truncate max-w-[60px]">{p}</span>
                            </th>
                          ))}
                          <th className="py-1 px-1 text-center text-[var(--color-muted)] font-medium">Load</th>
                        </tr>
                      </thead>
                      <tbody>
                        {members.map(member => {
                          const loadPct = Math.min(member.total_projects * 25, 100);
                          const loadColor = loadPct >= 100 ? 'bg-rose-500' : loadPct >= 75 ? 'bg-amber-500' : loadPct >= 50 ? 'bg-primary-500' : 'bg-emerald-500';
                          return (
                            <tr key={member.name} className="border-t border-[var(--color-border)]">
                              <td className="py-1.5 px-1 text-[var(--color-text)] font-medium truncate max-w-[100px] sticky left-0 bg-[var(--color-surface)]">{member.name}</td>
                              {allProjects.map(proj => {
                                const assignment = member.projects.find(p => p.project_name === proj);
                                return (
                                  <td key={proj} className="py-1.5 px-1 text-center">
                                    {assignment ? (
                                      <div className={`w-6 h-6 mx-auto rounded ${loadColor} bg-opacity-80 flex items-center justify-center`} title={`${member.name} - ${assignment.role} on ${proj}`}>
                                        <span className="text-white text-[9px] font-bold">{assignment.role.charAt(0)}</span>
                                      </div>
                                    ) : (
                                      <div className="w-6 h-6 mx-auto rounded bg-slate-100" />
                                    )}
                                  </td>
                                );
                              })}
                              <td className="py-1.5 px-1">
                                <div className="flex items-center gap-1 justify-center">
                                  <div className="cw-progress-track w-12 rounded-full h-2">
                                    <div className={`h-2 rounded-full ${loadColor}`} style={{ width: `${loadPct}%` }} />
                                  </div>
                                  <span className="text-[10px] text-[var(--color-muted)]">{loadPct}%</span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div className="flex items-center gap-3 mt-3 text-[10px] text-[var(--color-muted)]">
                      <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-emerald-500 rounded-sm" /> Low</span>
                      <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-primary-500 rounded-sm" /> Medium</span>
                      <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-amber-500 rounded-sm" /> High</span>
                      <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-rose-500 rounded-sm" /> Overloaded</span>
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="cw-card p-5">
              <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2"><Shield size={16} className="text-primary-600" /> Regulatory Alignment Matrix</h3>
              {Object.keys(enhanced.framework_alignment || {}).length === 0 ? (
                <p className="text-sm text-[var(--color-muted)] text-center py-6">No framework data</p>
              ) : (() => {
                const alignment = enhanced.framework_alignment as Record<string, Array<{project_id: number; project_name: string; status: string}>>;
                const frameworks = Object.keys(alignment);
                const projectMap = new Map<number, {name: string; frameworks: Record<string, string>}>();
                frameworks.forEach(fw => {
                  alignment[fw].forEach(p => {
                    if (!projectMap.has(p.project_id)) projectMap.set(p.project_id, { name: p.project_name, frameworks: {} });
                    projectMap.get(p.project_id)!.frameworks[fw] = p.status || 'Mapped';
                  });
                });
                const projects = Array.from(projectMap.entries()).slice(0, 8);
                const statusColor = (s: string) => {
                  const sl = s.toLowerCase();
                  if (sl.includes('compliant') || sl.includes('met') || sl.includes('complete')) return 'bg-emerald-500';
                  if (sl.includes('partial') || sl.includes('progress')) return 'bg-amber-400';
                  if (sl.includes('gap') || sl.includes('non') || sl.includes('fail')) return 'bg-rose-500';
                  return 'bg-primary-400';
                };
                return (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr>
                          <th className="text-left py-1 px-1 text-[var(--color-muted)] font-medium sticky left-0 bg-[var(--color-surface)]">Project</th>
                          {frameworks.map(fw => (
                            <th key={fw} className="py-1 px-1 text-center text-[var(--color-muted)] font-medium">
                              <span className="block truncate max-w-[60px]" title={fw}>{fw}</span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {projects.map(([pid, info]) => (
                          <tr key={pid} className="border-t border-[var(--color-border)] cursor-pointer hover:bg-[var(--color-subtle)]" onClick={() => router.push(`/is-projects/${pid}`)}>
                            <td className="py-1.5 px-1 text-[var(--color-text)] font-medium truncate max-w-[100px] sticky left-0 bg-[var(--color-surface)]">{info.name}</td>
                            {frameworks.map(fw => (
                              <td key={fw} className="py-1.5 px-1 text-center">
                                {info.frameworks[fw] ? (
                                  <div className={`w-6 h-6 mx-auto rounded ${statusColor(info.frameworks[fw])} flex items-center justify-center`} title={`${info.frameworks[fw]}`}>
                                    <span className="text-white text-[9px] font-bold">{info.frameworks[fw].charAt(0).toUpperCase()}</span>
                                  </div>
                                ) : (
                                  <div className="w-6 h-6 mx-auto rounded bg-slate-100 flex items-center justify-center">
                                    <span className="text-slate-400 text-[9px]">—</span>
                                  </div>
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="flex items-center gap-3 mt-3 text-[10px] text-[var(--color-muted)]">
                      <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-emerald-500 rounded-sm" /> Compliant</span>
                      <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-amber-400 rounded-sm" /> Partial</span>
                      <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-rose-500 rounded-sm" /> Gap</span>
                      <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-primary-400 rounded-sm" /> Mapped</span>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
