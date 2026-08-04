'use client';

import { useQuery } from '@tanstack/react-query';
import { enrichedDashboardApi } from '@/lib/api';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import {
  AlertTriangle,
  FileText,
  CheckCircle,
  Activity,
  TrendingUp,
  Shield,
} from 'lucide-react';

const STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b',
  in_progress: '#3b82f6',
  completed: '#10b981',
  rejected: '#ef4444',
  draft: '#6b7280',
  review: '#8b5cf6',
  approved: '#10b981',
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#dc2626',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e',
};

const IMPACT_COLORS: Record<string, string> = {
  critical: '#dc2626',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e',
  none: '#6b7280',
};

function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-28 rounded-xl bg-slate-800 border border-slate-700" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-80 rounded-xl bg-slate-800 border border-slate-700" />
        <div className="h-80 rounded-xl bg-slate-800 border border-slate-700" />
      </div>
      <div className="h-64 rounded-xl bg-slate-800 border border-slate-700" />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-yellow-500/20 text-yellow-400',
    in_progress: 'bg-blue-500/20 text-blue-400',
    completed: 'bg-green-500/20 text-green-400',
    rejected: 'bg-red-500/20 text-red-400',
    draft: 'bg-slate-500/20 text-slate-400',
    review: 'bg-purple-500/20 text-purple-400',
    approved: 'bg-green-500/20 text-green-400',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${colors[status?.toLowerCase()] || 'bg-slate-500/20 text-slate-400'}`}>
      {status?.replace(/_/g, ' ') || 'Unknown'}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const colors: Record<string, string> = {
    critical: 'bg-red-500/20 text-red-400',
    high: 'bg-orange-500/20 text-orange-400',
    medium: 'bg-yellow-500/20 text-yellow-400',
    low: 'bg-green-500/20 text-green-400',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${colors[priority?.toLowerCase()] || 'bg-slate-500/20 text-slate-400'}`}>
      {priority || 'Unknown'}
    </span>
  );
}

export default function RegulatoryImpactTab() {
  const { data: trackerData, isLoading: trackerLoading } = useQuery({
    queryKey: ['enriched-dashboard', 'regulatory', 'change-tracker'],
    queryFn: () => enrichedDashboardApi.getRegulatoryChangeTracker().then(r => r.data),
  });

  const { data: impactData, isLoading: impactLoading } = useQuery({
    queryKey: ['enriched-dashboard', 'regulatory', 'impact-summary'],
    queryFn: () => enrichedDashboardApi.getRegulatoryImpactSummary().then(r => r.data),
  });

  const { data: progressData, isLoading: progressLoading } = useQuery({
    queryKey: ['enriched-dashboard', 'regulatory', 'implementation-progress'],
    queryFn: () => enrichedDashboardApi.getRegulatoryImplementationProgress().then(r => r.data),
  });

  const { data: feedData, isLoading: feedLoading } = useQuery({
    queryKey: ['enriched-dashboard', 'regulatory', 'feed-analysis'],
    queryFn: () => enrichedDashboardApi.getRegulatoryFeedAnalysis().then(r => r.data),
  });

  const isLoading = trackerLoading || impactLoading || progressLoading || feedLoading;

  if (isLoading) return <LoadingSkeleton />;

  const totalChanges = trackerData?.total_changes ?? 0;
  const highPriority = trackerData?.by_priority?.high ?? 0;
  const criticalPriority = trackerData?.by_priority?.critical ?? 0;
  const highPriorityCount = highPriority + criticalPriority;
  const gapsIdentified = impactData?.gaps_identified ?? impactData?.total_gaps ?? 0;
  const completionRate = progressData?.completion_rate ?? progressData?.overall_completion ?? 0;

  const statusDonutData = Object.entries(trackerData?.by_status || {})
    .map(([name, value]) => ({
      name: name.replace(/_/g, ' '),
      value: value as number,
      color: STATUS_COLORS[name] || '#6b7280',
    }))
    .filter(d => d.value > 0);

  const statusTotal = statusDonutData.reduce((sum, d) => sum + d.value, 0);

  const impactLevelData = Object.entries(impactData?.by_impact_level || impactData?.impact_levels || {})
    .map(([name, value]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      value: value as number,
      fill: IMPACT_COLORS[name.toLowerCase()] || '#6b7280',
    }))
    .filter(d => d.value > 0);

  const changeProgressList = progressData?.change_progress || [];
  const recentChanges = trackerData?.recent_changes || [];

  const feedTotal = feedData?.total_items ?? feedData?.total ?? 0;
  const feedAnalyzed = feedData?.analyzed ?? feedData?.by_status?.analyzed ?? 0;
  const feedPending = feedData?.pending ?? feedData?.by_status?.pending ?? 0;
  const analysisRate = feedData?.analysis_rate ?? 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="rounded-lg bg-blue-500/20 p-2">
              <FileText className="h-4 w-4 text-blue-400" />
            </div>
            <span className="text-xs font-medium text-slate-400">Total Changes</span>
          </div>
          <p className="text-2xl font-bold text-white">{totalChanges}</p>
          <p className="text-xs text-slate-500 mt-1">Regulatory changes tracked</p>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800 p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="rounded-lg bg-red-500/20 p-2">
              <AlertTriangle className="h-4 w-4 text-red-400" />
            </div>
            <span className="text-xs font-medium text-slate-400">High Priority</span>
          </div>
          <p className="text-2xl font-bold text-white">{highPriorityCount}</p>
          <p className="text-xs text-slate-500 mt-1">Critical & high priority items</p>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800 p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="rounded-lg bg-amber-500/20 p-2">
              <Shield className="h-4 w-4 text-amber-400" />
            </div>
            <span className="text-xs font-medium text-slate-400">Gaps Identified</span>
          </div>
          <p className="text-2xl font-bold text-white">{gapsIdentified}</p>
          <p className="text-xs text-slate-500 mt-1">From impact assessments</p>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800 p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="rounded-lg bg-emerald-500/20 p-2">
              <CheckCircle className="h-4 w-4 text-emerald-400" />
            </div>
            <span className="text-xs font-medium text-slate-400">Completion Rate</span>
          </div>
          <p className="text-2xl font-bold text-white">{Math.round(completionRate)}%</p>
          <div className="mt-2 w-full bg-slate-700 rounded-full h-1.5">
            <div
              className="h-1.5 rounded-full bg-emerald-500 transition-all"
              style={{ width: `${Math.min(completionRate, 100)}%` }}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
          <div className="flex items-center gap-3 border-b border-slate-700 px-5 py-4">
            <div className="rounded-lg bg-purple-500/20 p-2">
              <Activity className="h-4 w-4 text-purple-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">Change Status Distribution</h3>
          </div>
          <div className="p-5 flex flex-col items-center">
            {statusDonutData.length > 0 ? (
              <>
                <div className="relative">
                  <ResponsiveContainer width={200} height={200}>
                    <PieChart>
                      <Pie
                        data={statusDonutData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={85}
                        dataKey="value"
                        strokeWidth={0}
                      >
                        {statusDonutData.map((entry, index) => (
                          <Cell key={index} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#1e293b',
                          border: '1px solid #334155',
                          borderRadius: '8px',
                          color: '#fff',
                          fontSize: '12px',
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-bold text-white">{statusTotal}</span>
                    <span className="text-xs text-slate-400">Total</span>
                  </div>
                </div>
                <div className="flex flex-wrap justify-center gap-3 mt-3">
                  {statusDonutData.map((d, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-xs">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                      <span className="text-slate-400 capitalize">{d.name}</span>
                      <span className="text-white font-medium">{d.value}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-slate-500">
                <Activity className="h-8 w-8 mb-2" />
                <p className="text-sm">No status data available</p>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
          <div className="flex items-center gap-3 border-b border-slate-700 px-5 py-4">
            <div className="rounded-lg bg-orange-500/20 p-2">
              <TrendingUp className="h-4 w-4 text-orange-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">Impact Level Distribution</h3>
          </div>
          <div className="p-5">
            {impactLevelData.length > 0 ? (
              <ResponsiveContainer width="100%" height={Math.max(200, impactLevelData.length * 50)}>
                <BarChart
                  data={impactLevelData}
                  layout="vertical"
                  margin={{ left: 10, right: 20 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    axisLine={{ stroke: '#334155' }}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    axisLine={{ stroke: '#334155' }}
                    width={70}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1e293b',
                      border: '1px solid #334155',
                      borderRadius: '8px',
                      color: '#fff',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} name="Changes">
                    {impactLevelData.map((entry, index) => (
                      <Cell key={index} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-slate-500">
                <TrendingUp className="h-8 w-8 mb-2" />
                <p className="text-sm">No impact data available</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
        <div className="flex items-center gap-3 border-b border-slate-700 px-5 py-4">
          <div className="rounded-lg bg-blue-500/20 p-2">
            <CheckCircle className="h-4 w-4 text-blue-400" />
          </div>
          <h3 className="text-sm font-semibold text-white">Implementation Progress</h3>
        </div>
        <div className="p-5">
          {changeProgressList.length > 0 ? (
            <div className="space-y-4">
              {changeProgressList.map((item: any, idx: number) => {
                const pct = item.progress ?? item.completion_percentage ?? 0;
                const barColor = pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-red-500';
                return (
                  <div key={idx} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-300 truncate max-w-[70%]">
                        {item.title || item.change_title || item.name || `Change #${idx + 1}`}
                      </span>
                      <span className="text-sm font-medium text-white">{Math.round(pct)}%</span>
                    </div>
                    <div className="w-full bg-slate-700 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${barColor} transition-all`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                    {(item.tasks_completed !== undefined && item.tasks_total !== undefined) && (
                      <p className="text-xs text-slate-500">
                        {item.tasks_completed} / {item.tasks_total} tasks completed
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-slate-500">
              <CheckCircle className="h-8 w-8 mb-2" />
              <p className="text-sm">No implementation progress data</p>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
        <div className="flex items-center gap-3 border-b border-slate-700 px-5 py-4">
          <div className="rounded-lg bg-cyan-500/20 p-2">
            <Activity className="h-4 w-4 text-cyan-400" />
          </div>
          <h3 className="text-sm font-semibold text-white">Feed Analysis Summary</h3>
        </div>
        <div className="p-5">
          <div className="grid gap-4 sm:grid-cols-4 mb-4">
            <div className="rounded-lg bg-slate-900/50 border border-slate-700 p-4 text-center">
              <p className="text-2xl font-bold text-white">{feedTotal}</p>
              <p className="text-xs text-slate-400 mt-1">Total Items</p>
            </div>
            <div className="rounded-lg bg-slate-900/50 border border-slate-700 p-4 text-center">
              <p className="text-2xl font-bold text-emerald-400">{feedAnalyzed}</p>
              <p className="text-xs text-slate-400 mt-1">Analyzed</p>
            </div>
            <div className="rounded-lg bg-slate-900/50 border border-slate-700 p-4 text-center">
              <p className="text-2xl font-bold text-yellow-400">{feedPending}</p>
              <p className="text-xs text-slate-400 mt-1">Pending</p>
            </div>
            <div className="rounded-lg bg-slate-900/50 border border-slate-700 p-4 text-center">
              <p className="text-2xl font-bold text-blue-400">{Math.round(analysisRate)}%</p>
              <p className="text-xs text-slate-400 mt-1">Analysis Rate</p>
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Analysis Progress</span>
              <span className="text-white font-medium">{Math.round(analysisRate)}%</span>
            </div>
            <div className="w-full bg-slate-700 rounded-full h-2.5">
              <div
                className="h-2.5 rounded-full bg-blue-500 transition-all"
                style={{ width: `${Math.min(analysisRate, 100)}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
        <div className="flex items-center gap-3 border-b border-slate-700 px-5 py-4">
          <div className="rounded-lg bg-indigo-500/20 p-2">
            <FileText className="h-4 w-4 text-indigo-400" />
          </div>
          <h3 className="text-sm font-semibold text-white">Recent Changes</h3>
        </div>
        <div className="p-4">
          {recentChanges.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-400 text-xs border-b border-slate-700">
                    <th className="text-left py-2 px-3 font-medium">Title</th>
                    <th className="text-center py-2 px-3 font-medium">Status</th>
                    <th className="text-center py-2 px-3 font-medium">Priority</th>
                    <th className="text-center py-2 px-3 font-medium">Impact</th>
                    <th className="text-right py-2 px-3 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {recentChanges.slice(0, 10).map((change: any, idx: number) => (
                    <tr key={idx} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                      <td className="py-2.5 px-3 text-slate-300 max-w-xs truncate">
                        {change.title || change.name || `Change #${change.id || idx + 1}`}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <StatusBadge status={change.status} />
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <PriorityBadge priority={change.priority} />
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          change.impact_level === 'high' || change.impact_level === 'critical'
                            ? 'bg-red-500/20 text-red-400'
                            : change.impact_level === 'medium'
                            ? 'bg-yellow-500/20 text-yellow-400'
                            : 'bg-green-500/20 text-green-400'
                        }`}>
                          {change.impact_level || 'N/A'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-400 text-xs">
                        {change.created_at || change.date
                          ? new Date(change.created_at || change.date).toLocaleDateString()
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-slate-500">
              <FileText className="h-8 w-8 mb-2" />
              <p className="text-sm">No recent changes</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
