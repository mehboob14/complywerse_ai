'use client';

import { useQuery } from '@tanstack/react-query';
import { enrichedDashboardApi } from '@/lib/api';
import {
  AlertTriangle,
  DollarSign,
  Clock,
  BookOpen,
  CheckCircle,
  TrendingUp,
  Search,
  Zap,
} from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  BarChart,
} from 'recharts';

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#dc2626',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e',
};

const TOOLTIP_STYLE = {
  backgroundColor: '#1e293b',
  border: '1px solid #334155',
  borderRadius: '8px',
  color: '#fff',
  fontSize: '12px',
};

function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-28 rounded-xl bg-slate-800 border border-slate-700" />
        ))}
      </div>
      <div className="h-80 rounded-xl bg-slate-800 border border-slate-700" />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-72 rounded-xl bg-slate-800 border border-slate-700" />
        <div className="h-72 rounded-xl bg-slate-800 border border-slate-700" />
      </div>
    </div>
  );
}

export default function IncidentDashTab() {
  const { data: summaryData, isLoading: summaryLoading } = useQuery({
    queryKey: ['enriched-dashboard', 'incident-summary'],
    queryFn: () => enrichedDashboardApi.getIncidentSummary().then(r => r.data),
  });

  const { data: responseData, isLoading: responseLoading } = useQuery({
    queryKey: ['enriched-dashboard', 'incident-response-times'],
    queryFn: () => enrichedDashboardApi.getIncidentResponseTimes().then(r => r.data),
  });

  const { data: rootCauseData, isLoading: rootCauseLoading } = useQuery({
    queryKey: ['enriched-dashboard', 'incident-root-causes'],
    queryFn: () => enrichedDashboardApi.getIncidentRootCauses().then(r => r.data),
  });

  const { data: trendData, isLoading: trendLoading } = useQuery({
    queryKey: ['enriched-dashboard', 'incident-trends'],
    queryFn: () => enrichedDashboardApi.getIncidentTrends().then(r => r.data),
  });

  const { data: lessonsData, isLoading: lessonsLoading } = useQuery({
    queryKey: ['enriched-dashboard', 'incident-lessons-learned'],
    queryFn: () => enrichedDashboardApi.getIncidentLessonsLearned().then(r => r.data),
  });

  if (summaryLoading && responseLoading && trendLoading) {
    return <LoadingSkeleton />;
  }

  const totalIncidents = summaryData?.total_incidents ?? 0;
  const financialImpact = summaryData?.financial_impact ?? 0;
  const bySeverity = summaryData?.by_severity ?? {};
  const byStatus = summaryData?.by_status ?? {};
  const last30d = summaryData?.last_30_days ?? summaryData?.incidents_last_30d ?? 0;

  const mttdHours = responseData?.mttd_hours ?? 0;
  const mttrHours = responseData?.mttr_hours ?? 0;
  const funnelData = responseData?.funnel ?? [];

  const trends = trendData ?? [];
  const rootCauses = rootCauseData ?? [];

  const captureRate = lessonsData?.capture_rate ?? 0;
  const implementationRate = lessonsData?.implementation_rate ?? 0;
  const recentLessons = lessonsData?.recent_lessons ?? [];

  const severityDonutData = Object.entries(bySeverity)
    .map(([name, value]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      value: value as number,
      color: SEVERITY_COLORS[name.toLowerCase()] ?? '#64748b',
    }))
    .filter(d => d.value > 0);

  const severityTotal = severityDonutData.reduce((s, d) => s + d.value, 0);

  const formatCurrency = (val: number) => {
    if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
    if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
    return `$${val.toFixed(0)}`;
  };

  const funnelSteps = funnelData.length > 0
    ? funnelData
    : [
        { stage: 'Detection (MTTD)', hours: mttdHours },
        { stage: 'Response', hours: Math.max(0, mttrHours - mttdHours) },
        { stage: 'Resolution (MTTR)', hours: mttrHours },
      ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="rounded-lg bg-red-500/20 p-2">
              <AlertTriangle className="h-4 w-4 text-red-400" />
            </div>
            <span className="text-sm text-slate-400">Total Incidents</span>
          </div>
          <p className="text-2xl font-bold text-white">{totalIncidents}</p>
          <p className="text-xs text-slate-500 mt-1">
            {Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(' · ')}
          </p>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800 p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="rounded-lg bg-amber-500/20 p-2">
              <DollarSign className="h-4 w-4 text-amber-400" />
            </div>
            <span className="text-sm text-slate-400">Financial Impact</span>
          </div>
          <p className="text-2xl font-bold text-white">{formatCurrency(financialImpact)}</p>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800 p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="rounded-lg bg-blue-500/20 p-2">
              <Clock className="h-4 w-4 text-blue-400" />
            </div>
            <span className="text-sm text-slate-400">Avg Response (MTTR)</span>
          </div>
          <p className="text-2xl font-bold text-white">{mttrHours.toFixed(1)}h</p>
          <p className="text-xs text-slate-500 mt-1">MTTD: {mttdHours.toFixed(1)}h</p>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800 p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="rounded-lg bg-cyan-500/20 p-2">
              <Zap className="h-4 w-4 text-cyan-400" />
            </div>
            <span className="text-sm text-slate-400">Last 30 Days</span>
          </div>
          <p className="text-2xl font-bold text-white">{last30d}</p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
        <div className="flex items-center gap-3 border-b border-slate-700 px-5 py-4">
          <div className="rounded-lg bg-purple-500/20 p-2">
            <TrendingUp className="h-4 w-4 text-purple-400" />
          </div>
          <h3 className="text-sm font-semibold text-white">Incident Trends</h3>
        </div>
        <div className="p-5">
          {trendLoading ? (
            <div className="h-64 flex items-center justify-center text-slate-500">Loading...</div>
          ) : trends.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={trends}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="month" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={{ stroke: '#334155' }} />
                <YAxis yAxisId="left" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={{ stroke: '#334155' }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={{ stroke: '#334155' }} tickFormatter={(v: number) => formatCurrency(v)} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ color: '#94a3b8', fontSize: '12px' }} />
                <Bar yAxisId="left" dataKey="total" fill="#6366f1" name="Total Incidents" radius={[4, 4, 0, 0]} />
                <Bar yAxisId="left" dataKey="critical" fill="#dc2626" name="Critical" radius={[4, 4, 0, 0]} stackId="sev" />
                <Bar yAxisId="left" dataKey="high" fill="#f97316" name="High" radius={[4, 4, 0, 0]} stackId="sev" />
                <Line yAxisId="right" type="monotone" dataKey="financial" stroke="#eab308" strokeWidth={2} dot={{ fill: '#eab308', r: 3 }} name="Financial Impact" />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-64 flex flex-col items-center justify-center text-slate-500">
              <TrendingUp className="h-8 w-8 mb-2" />
              <p className="text-sm">No trend data available</p>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
          <div className="flex items-center gap-3 border-b border-slate-700 px-5 py-4">
            <div className="rounded-lg bg-blue-500/20 p-2">
              <Clock className="h-4 w-4 text-blue-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">Response Time Funnel</h3>
          </div>
          <div className="p-5">
            {responseLoading ? (
              <div className="h-48 flex items-center justify-center text-slate-500">Loading...</div>
            ) : (
              <div className="space-y-4">
                {funnelSteps.map((step: any, idx: number) => {
                  const maxHours = Math.max(...funnelSteps.map((s: any) => s.hours || 0), 1);
                  const pct = ((step.hours || 0) / maxHours) * 100;
                  const colors = ['#3b82f6', '#8b5cf6', '#10b981'];
                  return (
                    <div key={idx}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-slate-300">{step.stage}</span>
                        <span className="text-white font-medium">{(step.hours || 0).toFixed(1)}h</span>
                      </div>
                      <div className="w-full bg-slate-700 rounded-full h-3">
                        <div
                          className="h-3 rounded-full transition-all duration-500"
                          style={{ width: `${Math.max(pct, 5)}%`, backgroundColor: colors[idx % colors.length] }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
          <div className="flex items-center gap-3 border-b border-slate-700 px-5 py-4">
            <div className="rounded-lg bg-red-500/20 p-2">
              <AlertTriangle className="h-4 w-4 text-red-400" />
            </div>
            <h3 className="text-sm font-semibold text-white">Severity Breakdown</h3>
          </div>
          <div className="p-5 flex flex-col items-center">
            {severityTotal > 0 ? (
              <>
                <div className="relative">
                  <ResponsiveContainer width={200} height={200}>
                    <PieChart>
                      <Pie
                        data={severityDonutData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={85}
                        dataKey="value"
                        strokeWidth={0}
                      >
                        {severityDonutData.map((entry, index) => (
                          <Cell key={index} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-bold text-white">{severityTotal}</span>
                    <span className="text-xs text-slate-400">Total</span>
                  </div>
                </div>
                <div className="flex flex-wrap justify-center gap-3 mt-3">
                  {severityDonutData.map((d, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-xs">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                      <span className="text-slate-400">{d.name}</span>
                      <span className="text-white font-medium">{d.value}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="h-48 flex flex-col items-center justify-center text-slate-500">
                <AlertTriangle className="h-8 w-8 mb-2" />
                <p className="text-sm">No severity data</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
        <div className="flex items-center gap-3 border-b border-slate-700 px-5 py-4">
          <div className="rounded-lg bg-orange-500/20 p-2">
            <Search className="h-4 w-4 text-orange-400" />
          </div>
          <h3 className="text-sm font-semibold text-white">Root Cause Analysis (Pareto)</h3>
        </div>
        <div className="p-5">
          {rootCauseLoading ? (
            <div className="h-64 flex items-center justify-center text-slate-500">Loading...</div>
          ) : rootCauses.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={rootCauses}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="root_cause" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={{ stroke: '#334155' }} angle={-20} textAnchor="end" height={60} />
                <YAxis yAxisId="left" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={{ stroke: '#334155' }} />
                <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={{ stroke: '#334155' }} tickFormatter={(v: number) => `${v}%`} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ color: '#94a3b8', fontSize: '12px' }} />
                <Bar yAxisId="left" dataKey="count" fill="#f97316" name="Incident Count" radius={[4, 4, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="cumulative_pct" stroke="#3b82f6" strokeWidth={2} dot={{ fill: '#3b82f6', r: 3 }} name="Cumulative %" />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-64 flex flex-col items-center justify-center text-slate-500">
              <Search className="h-8 w-8 mb-2" />
              <p className="text-sm">No root cause data available</p>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
        <div className="flex items-center gap-3 border-b border-slate-700 px-5 py-4">
          <div className="rounded-lg bg-emerald-500/20 p-2">
            <BookOpen className="h-4 w-4 text-emerald-400" />
          </div>
          <h3 className="text-sm font-semibold text-white">Lessons Learned</h3>
        </div>
        <div className="p-5">
          {lessonsLoading ? (
            <div className="h-32 flex items-center justify-center text-slate-500">Loading...</div>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-lg bg-slate-900/50 border border-slate-700 p-4 flex items-center gap-4">
                  <div className="rounded-lg bg-emerald-500/20 p-3">
                    <CheckCircle className="h-5 w-5 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Capture Rate</p>
                    <p className="text-xl font-bold text-white">{(captureRate * 100).toFixed(0)}%</p>
                  </div>
                </div>
                <div className="rounded-lg bg-slate-900/50 border border-slate-700 p-4 flex items-center gap-4">
                  <div className="rounded-lg bg-blue-500/20 p-3">
                    <TrendingUp className="h-5 w-5 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Implementation Rate</p>
                    <p className="text-xl font-bold text-white">{(implementationRate * 100).toFixed(0)}%</p>
                  </div>
                </div>
              </div>

              {recentLessons.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-3">Recent Lessons</h4>
                  <div className="space-y-2">
                    {recentLessons.slice(0, 5).map((lesson: any, idx: number) => (
                      <div key={idx} className="rounded-lg bg-slate-900/50 border border-slate-700 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm text-slate-300">{lesson.title || lesson.description || lesson.lesson}</p>
                          {lesson.status && (
                            <span className={`text-xs px-2 py-0.5 rounded whitespace-nowrap ${
                              lesson.status === 'implemented' ? 'bg-emerald-500/20 text-emerald-400' :
                              lesson.status === 'in_progress' ? 'bg-blue-500/20 text-blue-400' :
                              'bg-slate-500/20 text-slate-400'
                            }`}>
                              {lesson.status}
                            </span>
                          )}
                        </div>
                        {lesson.incident_title && (
                          <p className="text-xs text-slate-500 mt-1">From: {lesson.incident_title}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
