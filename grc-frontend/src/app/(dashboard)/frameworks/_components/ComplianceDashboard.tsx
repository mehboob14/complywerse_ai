'use client';

// ComplianceDashboard
// ─────────────────────────────────────────────────────────────────────────
// Top-of-page widget cluster for /frameworks. Five surfaces:
//   1. Hero — Overall Readiness radial gauge + status pill stack + 3 mini KPIs
//   2. Status Mix — Multi-ring donut with center total
//   3. Per-Framework Cards — Mini-gauge per journey with progress, chips, drill-through
//   4. Domain Heat-strip — Coloured intensity squares for top domains
//   5. Activity Timeline — Day-grouped recent events
//
// All data comes from a single backend aggregate endpoint. Hides cleanly
// when there are no journeys yet.

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  ResponsiveContainer,
  RadialBarChart, RadialBar, PolarAngleAxis,
  PieChart, Pie, Cell, Tooltip,
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import {
  Activity, Award, BadgeCheck, CheckCircle2, Clock, FileCheck,
  Target, TrendingUp, Calendar,
  ChevronRight, Sparkles, ArrowUpRight, Zap,
  Gauge, PieChart as PieIcon,
} from 'lucide-react';
import { complianceApi } from '@/lib/api';

// ─── Types ──────────────────────────────────────────────────────────────
interface FrameworkRow {
  journey_id: number;
  framework_id: number | null;
  name: string;
  framework_name: string;
  classification: string | null;
  status: string;
  target_date: string | null;
  started_at: string | null;
  total: number;
  implemented: number;
  verified: number;
  in_progress: number;
  not_started: number;
  not_applicable: number;
  completion_pct: number;
  readiness_pct: number;
}

interface DomainRow {
  domain: string;
  total: number;
  completed: number;
  completion_pct: number;
}

interface ActivityRow {
  type: string;
  journey_id: number;
  framework_name: string;
  control_code: string | null;
  control_name: string | null;
  status: string;
  when: string;
}

interface DashboardData {
  kpis: {
    active_journeys: number;
    completed_journeys: number;
    total_journeys: number;
    total_controls: number;
    implemented: number;
    verified: number;
    in_progress: number;
    not_started: number;
    not_applicable: number;
    approved_evidence_count: number;
    avg_completion_pct: number;
    avg_readiness_pct: number;
    open_gaps: number;
  };
  status_mix: Array<{ key: string; name: string; value: number; color: string }>;
  by_framework: FrameworkRow[];
  by_domain: DomainRow[];
  recent_activity: ActivityRow[];
}

// ─── Helpers ────────────────────────────────────────────────────────────
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}d`;
  return new Date(iso).toLocaleDateString();
}

function bucketByDay(items: ActivityRow[]): Array<{ label: string; items: ActivityRow[] }> {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yest = new Date(today); yest.setDate(yest.getDate() - 1);
  const buckets: Record<string, ActivityRow[]> = {};
  items.forEach((a) => {
    const d = new Date(a.when); d.setHours(0, 0, 0, 0);
    let label: string;
    if (d.getTime() === today.getTime()) label = 'Today';
    else if (d.getTime() === yest.getTime()) label = 'Yesterday';
    else label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    (buckets[label] ||= []).push(a);
  });
  return Object.entries(buckets).map(([label, items]) => ({ label, items }));
}

// ─── Posture Overview — gauge + status donut + compliance trend ────────
const TREND_RANGES = [
  { label: '7 Days', days: 7 },
  { label: '15 Days', days: 15 },
  { label: '1 Month', days: 30 },
  { label: '1 Year', days: 365 },
  { label: 'Custom', days: -1 },
];

function PanelCard({ title, icon, right, children }: { title: string; icon: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-50 ring-1 ring-primary-100">{icon}</div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700">{title}</h3>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function MiniBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between text-[11px]">
        <span className="text-slate-600">{label}</span>
        <span className="font-semibold tabular-nums text-slate-800">{value}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, value)}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function PostureOverview({ data }: { data: DashboardData }) {
  const { kpis, status_mix } = data;
  const [rangeIdx, setRangeIdx] = useState(0);
  const [customDays, setCustomDays] = useState(30);
  const range = TREND_RANGES[rangeIdx];
  const days = range.days === -1 ? Math.max(1, customDays) : range.days;

  const { data: trendResp } = useQuery({
    queryKey: ['compliance-trend', days],
    queryFn: async () =>
      (await complianceApi.dashboard.getComplianceTrend(days)).data as { trend: Array<{ label: string; completion: number; readiness: number }> },
    staleTime: 60_000,
  });
  const trend = trendResp?.trend || [];

  const completion = Math.round(kpis.avg_completion_pct);
  const color = completion >= 75 ? '#22c55e' : completion >= 40 ? '#f59e0b' : '#ef4444';
  const applicable = kpis.total_controls - kpis.not_applicable;
  const donut = status_mix.filter((s) => s.value > 0);
  const donutTotal = donut.reduce((a, s) => a + s.value, 0);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        {/* Overview gauge */}
        <PanelCard title="Overview" icon={<Gauge className="h-3.5 w-3.5 text-primary-600" strokeWidth={1.75} />}>
          <div className="flex items-center gap-4">
            <div className="relative h-[150px] w-[150px] shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart innerRadius="76%" outerRadius="100%" data={[{ value: completion }]} startAngle={90} endAngle={-270}>
                  <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                  <RadialBar dataKey="value" cornerRadius={10} fill={color} background={{ fill: '#f1f5f9' }} />
                </RadialBarChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-3xl font-bold tabular-nums" style={{ color }}>{completion}%</span>
                <span className="mt-0.5 text-[10px] text-slate-400">{kpis.implemented} of {applicable} total</span>
              </div>
            </div>
            <div className="flex-1 space-y-2">
              <MiniBar label="Readiness" value={Math.round(kpis.avg_readiness_pct)} color="#10b981" />
              <MiniBar label="Compliant" value={completion} color={color} />
              <div className="flex items-center justify-between gap-2 pt-1 text-[11px] text-slate-500">
                <span>{kpis.approved_evidence_count} approved</span>
                <span className="text-rose-600">{kpis.open_gaps} open gaps</span>
              </div>
            </div>
          </div>
        </PanelCard>

        {/* Status donut */}
        <PanelCard title="Status" icon={<PieIcon className="h-3.5 w-3.5 text-primary-600" strokeWidth={1.75} />}>
          {donutTotal > 0 ? (
            <div className="grid items-center gap-3 sm:grid-cols-[170px_1fr]">
              <div className="relative h-[160px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={donut} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={52} outerRadius={78} paddingAngle={2} stroke="#fff" strokeWidth={2}>
                      {donut.map((e) => <Cell key={e.key} fill={e.color} />)}
                    </Pie>
                    <Tooltip formatter={(v: any, n: any) => [v, n]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-2xl font-bold text-slate-900 tabular-nums">{donutTotal}</span>
                  <span className="text-[9px] uppercase tracking-wider text-slate-500">Controls</span>
                </div>
              </div>
              <div className="space-y-1.5">
                {donut.map((s) => (
                  <div key={s.key} className="flex items-center gap-2 text-[11px]">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
                    <span className="flex-1 truncate text-slate-600">{s.name}</span>
                    <span className="font-semibold tabular-nums text-slate-800">{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex h-[160px] items-center justify-center text-xs text-slate-400">No control data yet</div>
          )}
        </PanelCard>
      </div>

      {/* Compliance Trend with time-range selector */}
      <PanelCard
        title="Compliance Trend"
        icon={<TrendingUp className="h-3.5 w-3.5 text-primary-600" strokeWidth={1.75} />}
        right={
          <div className="flex items-center gap-2">
            <select value={rangeIdx} onChange={(e) => setRangeIdx(Number(e.target.value))}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 focus:outline-none">
              {TREND_RANGES.map((r, i) => <option key={r.label} value={i}>{r.label}</option>)}
            </select>
            {range.days === -1 && (
              <input type="number" min={1} value={customDays} onChange={(e) => setCustomDays(Math.max(1, Number(e.target.value) || 1))}
                className="w-20 rounded-md border border-slate-200 px-2 py-1 text-xs focus:outline-none" placeholder="days" />
            )}
          </div>
        }
      >
        {trend.length >= 2 ? (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={trend} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="cdComp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22c55e" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#64748b' }} unit="%" />
              <Tooltip formatter={(v: any, n: any) => [`${v}%`, n === 'completion' ? 'Compliant' : 'Readiness']} />
              <Area type="monotone" dataKey="completion" stroke="#22c55e" strokeWidth={2} fill="url(#cdComp)" />
              <Area type="monotone" dataKey="readiness" stroke="#1ed4b0" strokeWidth={2} fill="none" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="py-10 text-center text-xs text-slate-400">
            Trend builds up over time — {trend.length} point{trend.length === 1 ? '' : 's'} so far for this range. Open frameworks to record snapshots.
          </div>
        )}
      </PanelCard>
    </div>
  );
}

// ─── Per-Framework Cards with Mini-Gauges ───────────────────────────────
function FrameworkCard({ f }: { f: FrameworkRow }) {
  const pct = f.readiness_pct;
  const color = pct >= 75 ? '#10b981' : pct >= 50 ? '#1ed4b0' : pct >= 25 ? '#f59e0b' : '#f43f5e';
  const textColor = pct >= 75 ? 'text-emerald-700' : pct >= 50 ? 'text-primary-700' : pct >= 25 ? 'text-amber-700' : 'text-rose-700';

  const gaugeData = [{ value: pct, fill: color }];
  const target = f.target_date ? new Date(f.target_date) : null;
  const daysToTarget = target ? Math.ceil((target.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;
  const isUrgent = daysToTarget !== null && daysToTarget <= 30 && daysToTarget >= 0;
  const isOverdue = daysToTarget !== null && daysToTarget < 0;

  return (
    <Link
      href={`/frameworks/${f.journey_id}`}
      className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-all hover:border-primary-300 hover:shadow-md"
    >
      {/* Mini radial gauge */}
      <div className="relative h-[58px] w-[58px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            innerRadius="72%"
            outerRadius="100%"
            data={gaugeData}
            startAngle={90}
            endAngle={-270}
          >
            <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
            <RadialBar dataKey="value" cornerRadius={6} fill={color} background={{ fill: '#f1f5f9' }} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className={`text-xs font-bold tabular-nums ${textColor}`}>{pct}%</span>
        </div>
      </div>

      {/* Detail column */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
          <span className="truncate text-sm font-semibold text-slate-900 group-hover:text-primary-700">
            {f.framework_name}
          </span>
          {f.classification && (
            <span className={`rounded border px-1 py-px text-[9px] font-medium uppercase ${
              f.classification === 'certification'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-primary-200 bg-primary-50 text-primary-700'
            }`}>
              {f.classification === 'certification' ? 'Cert' : 'Comp'}
            </span>
          )}
          {isOverdue && (
            <span className="inline-flex items-center gap-0.5 rounded border border-rose-200 bg-rose-50 px-1 py-px text-[9px] font-medium text-rose-700">
              <Calendar className="h-2.5 w-2.5" />Overdue
            </span>
          )}
          {isUrgent && !isOverdue && (
            <span className="inline-flex items-center gap-0.5 rounded border border-amber-200 bg-amber-50 px-1 py-px text-[9px] font-medium text-amber-700">
              <Calendar className="h-2.5 w-2.5" />{daysToTarget}d
            </span>
          )}
        </div>

        {/* Status mini-bar */}
        <div className="mb-1 flex h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          {f.total > 0 && (
            <>
              {f.implemented > 0 && <div className="h-full bg-emerald-500" style={{ width: `${(f.implemented / f.total) * 100}%` }} />}
              {f.in_progress > 0 && <div className="h-full bg-primary-500" style={{ width: `${(f.in_progress / f.total) * 100}%` }} />}
              {f.not_started > 0 && <div className="h-full bg-slate-300" style={{ width: `${(f.not_started / f.total) * 100}%` }} />}
              {f.not_applicable > 0 && <div className="h-full bg-slate-100" style={{ width: `${(f.not_applicable / f.total) * 100}%` }} />}
            </>
          )}
        </div>

        <div className="flex items-center gap-2 text-[10px] text-slate-500">
          <span className="inline-flex items-center gap-0.5"><CheckCircle2 className="h-2.5 w-2.5 text-emerald-500" strokeWidth={1.75} />{f.implemented}</span>
          <span className="inline-flex items-center gap-0.5"><Clock className="h-2.5 w-2.5 text-primary-500" strokeWidth={1.75} />{f.in_progress}</span>
          <span className="inline-flex items-center gap-0.5"><Target className="h-2.5 w-2.5 text-slate-400" strokeWidth={1.75} />{f.not_started}</span>
          <span className="ml-auto inline-flex items-center text-slate-400">
            {f.total} ctrls
          </span>
        </div>
      </div>

      <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-primary-500 shrink-0 transition-colors" strokeWidth={1.75} />
    </Link>
  );
}

function PerFrameworkSection({ data }: { data: DashboardData }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-50 ring-1 ring-primary-100">
            <Award className="h-3.5 w-3.5 text-primary-600" strokeWidth={1.75} />
          </div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700">
            Active Framework Journeys
          </h3>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
          {data.by_framework.length} journeys
        </span>
      </div>

      {data.by_framework.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <Sparkles className="mb-2 h-7 w-7 text-slate-300" />
          <p className="text-xs text-slate-500">Start your first framework journey below to see progress here.</p>
        </div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2 max-h-[340px] overflow-y-auto pr-1">
          {data.by_framework.map((f) => (
            <FrameworkCard key={f.journey_id} f={f} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Domain Heat-strip ──────────────────────────────────────────────────
function DomainHeatStrip({ data }: { data: DashboardData }) {
  // Compute intensity from completion %. Use a 5-step palette so it reads
  // as a heat scale rather than a noisy gradient.
  const cellTone = (pct: number): { bg: string; ring: string; text: string } => {
    if (pct >= 80) return { bg: 'bg-emerald-500', ring: 'ring-emerald-600/20', text: 'text-white' };
    if (pct >= 60) return { bg: 'bg-emerald-300', ring: 'ring-emerald-400/30', text: 'text-emerald-900' };
    if (pct >= 40) return { bg: 'bg-amber-200',   ring: 'ring-amber-300/40',   text: 'text-amber-900' };
    if (pct >= 20) return { bg: 'bg-rose-200',    ring: 'ring-rose-300/40',    text: 'text-rose-900' };
    return                  { bg: 'bg-slate-100',   ring: 'ring-slate-200',      text: 'text-slate-500' };
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-50 ring-1 ring-amber-100">
            <Zap className="h-3.5 w-3.5 text-amber-600" />
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700">
              Domain Heat-map
            </h3>
            <p className="text-[10px] text-slate-500 mt-0.5">Coverage % per control domain</p>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-1 text-[9px] text-slate-500">
          <span>Low</span>
          {[0, 25, 45, 65, 85].map((p) => {
            const t = cellTone(p);
            return <span key={p} className={`h-2.5 w-3 ${t.bg} rounded-sm`} />;
          })}
          <span>High</span>
        </div>
      </div>

      {data.by_domain.length === 0 ? (
        <div className="flex items-center justify-center py-8 text-xs text-slate-400">
          No domain data yet
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {data.by_domain.slice(0, 10).map((d) => {
            const t = cellTone(d.completion_pct);
            return (
              <div
                key={d.domain}
                className={`relative rounded-lg ${t.bg} ring-1 ${t.ring} p-2.5 transition-transform hover:scale-[1.02] cursor-default`}
                title={`${d.domain} — ${d.completed}/${d.total} (${d.completion_pct}%)`}
              >
                <div className={`text-[9px] font-semibold uppercase tracking-wider ${t.text} opacity-80 truncate`}>
                  {d.domain}
                </div>
                <div className={`mt-0.5 flex items-baseline gap-1 ${t.text}`}>
                  <span className="text-lg font-bold tabular-nums">{d.completion_pct}<span className="text-[10px] opacity-70">%</span></span>
                </div>
                <div className={`text-[9px] ${t.text} opacity-75 mt-0.5`}>
                  {d.completed} / {d.total}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Activity Timeline ──────────────────────────────────────────────────
function ActivityTimeline({ data }: { data: DashboardData }) {
  const groups = useMemo(() => bucketByDay(data.recent_activity), [data.recent_activity]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 ring-1 ring-emerald-100">
            <Activity className="h-3.5 w-3.5 text-emerald-600" />
          </div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700">
            Recent Activity
          </h3>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
          {data.recent_activity.length}
        </span>
      </div>

      {groups.length === 0 ? (
        <div className="flex items-center justify-center py-8 text-xs text-slate-400">
          No activity yet
        </div>
      ) : (
        <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
          {groups.map((g) => (
            <div key={g.label}>
              <div className="sticky top-0 z-10 mb-1.5 -mx-1 bg-white px-1 pb-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  {g.label}
                </span>
              </div>
              <ul className="space-y-1.5">
                {g.items.map((a, i) => {
                  const isApproved = a.status === 'approved';
                  const isRejected = a.status === 'rejected';
                  const Icon = a.type === 'evidence_uploaded' ? FileCheck
                    : a.type === 'implemented' ? BadgeCheck : Activity;
                  const iconTone = isApproved ? 'bg-emerald-100 text-emerald-700'
                    : isRejected ? 'bg-rose-100 text-rose-700'
                    : a.type === 'implemented' ? 'bg-primary-100 text-primary-700'
                    : 'bg-slate-100 text-slate-600';
                  return (
                    <li key={`${g.label}-${i}`} className="flex items-start gap-2">
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${iconTone}`}>
                        <Icon className="h-3 w-3" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1 flex-wrap">
                          <Link
                            href={`/frameworks/${a.journey_id}`}
                            className="text-[11px] font-medium text-slate-900 hover:text-primary-600 truncate"
                          >
                            {a.control_code || 'Control'}
                          </Link>
                          {isApproved && (
                            <span className="rounded bg-emerald-50 px-1 text-[9px] font-medium text-emerald-700">approved</span>
                          )}
                          {isRejected && (
                            <span className="rounded bg-rose-50 px-1 text-[9px] font-medium text-rose-700">rejected</span>
                          )}
                          <span className="ml-auto text-[10px] text-slate-400 shrink-0">{timeAgo(a.when)} ago</span>
                        </div>
                        <p className="truncate text-[10px] text-slate-500">
                          {a.type === 'evidence_uploaded' ? 'Evidence uploaded' : 'Marked implemented'} · {a.framework_name}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main export ────────────────────────────────────────────────────────
export function ComplianceDashboard() {
  const { data, isLoading, error } = useQuery<DashboardData>({
    queryKey: ['compliance-frameworks-aggregate'],
    queryFn: async () => {
      const r = await complianceApi.dashboard.getFrameworksAggregate();
      return r.data as DashboardData;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="h-[230px] rounded-2xl border border-slate-200 bg-white shadow-sm animate-pulse" />
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="h-[260px] rounded-2xl border border-slate-200 bg-white shadow-sm animate-pulse" />
          <div className="h-[260px] rounded-2xl border border-slate-200 bg-white shadow-sm animate-pulse lg:col-span-2" />
        </div>
      </div>
    );
  }
  if (error || !data) return null;
  if (data.kpis.total_journeys === 0) return null;

  return (
    <section className="space-y-3">
      <PostureOverview data={data} />

      <PerFrameworkSection data={data} />

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <DomainHeatStrip data={data} />
        </div>
        <ActivityTimeline data={data} />
      </div>
    </section>
  );
}
