'use client';

// Closure Tracker — analytics dashboard inside the Issues module.
// Mirrors the Compliance Dashboard layout convention.

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { Activity, AlertTriangle, Clock, CheckCircle2, ListChecks, Calendar, Layers } from 'lucide-react';
import { issuesApi } from '@/lib/api';
import { SeverityChip } from './shared';
import { IssueAnalytics, type IssueAnalyticsPayload } from './IssueAnalytics';

interface DashboardPayload extends IssueAnalyticsPayload {
  kpis: {
    open: number; in_progress: number; awaiting_closure: number;
    closed_30d: number; sla_breached: number; avg_time_to_close_days: number;
    critical_open: number; total: number;
  };
  status_mix: Array<{ key: string; name: string; value: number; color: string }>;
  ageing_buckets: Array<{ label: string; count: number }>;
  by_category: Array<{ category: string; open: number; closed_30d: number }>;
  by_severity: Array<{ severity: string; count: number }>;
  sla_breach_feed: Array<{ id: number; code: string; title: string; severity: string; target_closure_date: string | null; days_overdue: number }>;
  recent_activity: Array<{ type: string; issue_id: number; code: string; title: string; user: string | null; when: string }>;
}

function KpiCard({
  icon: Icon, label, value, accent, hint,
}: { icon: React.ElementType; label: string; value: string | number; accent: 'blue' | 'emerald' | 'amber' | 'rose' | 'slate' | 'indigo'; hint?: string }) {
  // Brand-accent tones (blue/indigo) flattened to the teal primary; the
  // sanctioned ramp tones (emerald/amber/rose/slate) are kept as-is.
  const tones: Record<string, { bg: string; text: string; ring: string }> = {
    blue:    { bg: 'bg-primary-50', text: 'text-primary-700', ring: 'ring-primary-100' },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-100' },
    amber:   { bg: 'bg-amber-50',   text: 'text-amber-700',   ring: 'ring-amber-100' },
    rose:    { bg: 'bg-rose-50',    text: 'text-rose-700',    ring: 'ring-rose-100' },
    slate:   { bg: 'bg-slate-50',   text: 'text-slate-700',   ring: 'ring-slate-100' },
    indigo:  { bg: 'bg-primary-50', text: 'text-primary-700', ring: 'ring-primary-100' },
  };
  const t = tones[accent];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</span>
        <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${t.bg} ring-1 ${t.ring}`}>
          <Icon className={`h-3.5 w-3.5 ${t.text}`} />
        </div>
      </div>
      <div className={`mt-1.5 text-2xl font-semibold ${t.text}`}>{value}</div>
      {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

export function ClosureTracker() {
  const { data, isLoading, error } = useQuery<DashboardPayload>({
    queryKey: ['issues-dashboard'],
    queryFn: async () => (await issuesApi.dashboard()).data,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return <div className="h-[240px] rounded-xl border border-slate-200 bg-white animate-pulse" />;
  }
  if (error || !data) return null;
  if (data.kpis.total === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-slate-50/40 py-10 text-center">
        <ListChecks className="mb-2 h-7 w-7 text-slate-300" />
        <h3 className="text-sm font-semibold text-slate-700">No issues yet</h3>
        <p className="mt-1 max-w-sm text-xs text-slate-500">
          Create an issue or use the &quot;+ Create Issue&quot; button on a vuln / risk / asset / control detail page.
        </p>
      </div>
    );
  }

  const { kpis, status_mix, ageing_buckets, by_category, by_severity, sla_breach_feed, recent_activity } = data;

  return (
    <div className="space-y-3">
      {/* Analytical lenses — trend, MTTR, sources, owners, SLA quality,
          severity-age heatmap. Sits above the existing KPI strip so the
          "are we getting better?" view is the first thing the operator
          sees on the tab. All datasets come from the same /aggregate call. */}
      <IssueAnalytics payload={data} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <KpiCard icon={Layers} label="Total" value={kpis.total} accent="slate" hint={`${kpis.open} open`} />
        <KpiCard icon={Clock} label="In Progress" value={kpis.in_progress} accent="blue" />
        <KpiCard icon={Calendar} label="Awaiting Closure" value={kpis.awaiting_closure} accent="amber" />
        <KpiCard icon={CheckCircle2} label="Closed (30d)" value={kpis.closed_30d} accent="emerald" hint={`avg ${kpis.avg_time_to_close_days}d`} />
        <KpiCard icon={AlertTriangle} label="Critical Open" value={kpis.critical_open} accent="rose" />
        <KpiCard icon={Activity} label="SLA Breached" value={kpis.sla_breached} accent={kpis.sla_breached ? 'rose' : 'emerald'} />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {/* Status mix donut */}
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-700">Status Mix</h3>
          {status_mix.length > 0 ? (
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={status_mix} dataKey="value" nameKey="name" innerRadius={48} outerRadius={78} paddingAngle={2} stroke="#fff" strokeWidth={2}>
                    {status_mix.map((s) => <Cell key={s.key} fill={s.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6, border: '1px solid #e2e8f0' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : <div className="flex h-[200px] items-center justify-center text-xs text-slate-400">No data</div>}
        </div>

        {/* Ageing bars */}
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-700">Open by Age</h3>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ageing_buckets} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6, border: '1px solid #e2e8f0' }} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} fill="#1ed4b0" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* By severity */}
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-700">By Severity</h3>
          {by_severity.length > 0 ? (
            <div className="space-y-1.5">
              {by_severity.map((s) => {
                const max = Math.max(...by_severity.map((x) => x.count), 1);
                const pct = (s.count / max) * 100;
                const color = s.severity === 'critical' ? '#f43f5e' : s.severity === 'high' ? '#fb923c' : s.severity === 'medium' ? '#f59e0b' : s.severity === 'low' ? '#10b981' : '#94a3b8';
                return (
                  <div key={s.severity}>
                    <div className="flex items-center justify-between text-[11px]">
                      <SeverityChip severity={s.severity} />
                      <span className="font-semibold text-slate-800 tabular-nums">{s.count}</span>
                    </div>
                    <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <p className="text-xs text-slate-400">No data</p>}
        </div>
      </div>

      {/* SLA breach feed + Recent activity */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-700">SLA Breaches</h3>
          {sla_breach_feed.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">No breaches — nice work.</p>
          ) : (
            <ul className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
              {sla_breach_feed.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 hover:bg-slate-50">
                  <Link href={`/issues/${b.id}`} className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[11px] font-semibold text-slate-800">{b.code}</span>
                    <span className="truncate text-[11px] text-slate-600">{b.title}</span>
                  </Link>
                  <span className="inline-flex items-center gap-1.5 text-[10px] text-rose-700 shrink-0">
                    <SeverityChip severity={b.severity} />
                    <span className="font-semibold">{b.days_overdue}d overdue</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-700">Recent Activity</h3>
          {recent_activity.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">No activity yet.</p>
          ) : (
            <ul className="space-y-1 max-h-[220px] overflow-y-auto pr-1">
              {recent_activity.map((a, i) => (
                <li key={i} className="flex gap-1.5 text-[11px] py-0.5">
                  <span className="rounded bg-slate-100 px-1 text-[9px] font-medium uppercase text-slate-600 shrink-0 self-center">
                    {a.type.replace(/_/g, ' ')}
                  </span>
                  <Link href={`/issues/${a.issue_id}`} className="font-semibold text-slate-800 hover:text-primary-700 shrink-0">{a.code}</Link>
                  <span className="truncate text-slate-600">{a.title}</span>
                  <span className="ml-auto text-[10px] text-slate-400 shrink-0">{new Date(a.when).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* By category */}
      {by_category.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-700">By Category</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {by_category.map((c) => (
              <div key={c.category} className="rounded-lg border border-slate-200 bg-slate-50/50 p-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">{c.category}</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-lg font-bold text-slate-900 tabular-nums">{c.open}</span>
                  <span className="text-[10px] text-slate-400">open</span>
                  <span className="ml-auto text-[10px] text-emerald-700 tabular-nums">+{c.closed_30d}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
