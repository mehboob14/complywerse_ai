'use client';

/**
 * IssueAnalytics — analytical lenses rendered above the existing
 * Closure Tracker. Six panels designed around the questions an issue-
 * management operator actually asks:
 *
 *   1. Trend       — are we creating issues faster than we close them?
 *   2. MTTR        — how fast do we resolve, broken out by severity?
 *   3. Sources     — where do issues come from (vuln / risk / asset / …)?
 *   4. Owners      — who carries the load? (named-assignee view)
 *   5. SLA quality — when we close, do we hit the SLA?
 *   6. Heatmap     — where are the old + critical cells?
 *
 * Every dataset comes from a single `/issues/dashboard/aggregate` call;
 * the component is pure presentation. Charts use Recharts (already in
 * the project). No new dependencies.
 */

import { useMemo } from 'react';
import {
  ResponsiveContainer,
  PieChart, Pie, Cell,
  BarChart, Bar,
  LineChart, Line,
  AreaChart, Area,
  ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
} from 'recharts';
import {
  TrendingUp, Activity, Layers, Users, Gauge, Grid3x3, RotateCw,
} from 'lucide-react';

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'informational'] as const;
type Severity = (typeof SEVERITY_ORDER)[number];

// Sanctioned severity ramp (critical=rose, high=orange, medium=amber,
// low=emerald, informational=slate). Genuine data-viz scale.
const SEVERITY_COLOR: Record<Severity, string> = {
  critical: '#f43f5e',
  high: '#f97316',
  medium: '#f59e0b',
  low: '#10b981',
  informational: '#94a3b8',
};

interface TrendPoint {
  week_start: string;
  label: string;
  opened: number;
  closed: number;
  net: number;
}

interface MttrRow {
  severity: Severity;
  count: number;
  mean_days: number | null;
  median_days: number | null;
  color: string;
}

interface SourceRow {
  name: string;
  value: number;
  critical: number;
  color: string;
}

interface AssigneeRow {
  user_id: number;
  name: string;
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  informational: number;
}

interface SlaRow {
  severity: Severity;
  count: number;
  compliant_pct: number | null;
  color: string;
}

interface HeatmapRow {
  severity: Severity;
  color: string;
  cells: Array<{ bucket: string; count: number }>;
  total: number;
}

interface ReopenStats {
  reopen_count: number;
  closed_total: number;
  reopen_rate_pct: number | null;
}

export interface IssueAnalyticsPayload {
  trend_12w?: TrendPoint[];
  mttr_by_severity?: MttrRow[];
  by_source?: SourceRow[];
  top_assignees?: AssigneeRow[];
  sla_compliance_by_severity?: SlaRow[];
  severity_age_matrix?: HeatmapRow[];
  reopen_stats?: ReopenStats;
}

// ─── Shared chrome ──────────────────────────────────────────────────────────

function Panel({
  icon: Icon, title, subtitle, children, className,
}: {
  icon: React.ElementType;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col ${className ?? ''}`}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700 inline-flex items-center gap-1.5">
            <Icon className="h-3.5 w-3.5 text-slate-500" />
            {title}
          </h3>
          {subtitle && <p className="mt-0.5 text-[11px] text-slate-500">{subtitle}</p>}
        </div>
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-[180px] items-center justify-center text-xs text-slate-400">
      {label}
    </div>
  );
}

// ─── Trend: opened vs closed (12 weeks) ─────────────────────────────────────

function TrendPanel({ data }: { data?: TrendPoint[] }) {
  if (!data || data.length === 0) return <EmptyState label="No trend data yet" />;
  // Totals for the subtitle so the operator gets an at-a-glance read.
  const totalOpened = data.reduce((s, d) => s + d.opened, 0);
  const totalClosed = data.reduce((s, d) => s + d.closed, 0);
  const net = totalOpened - totalClosed;
  return (
    <>
      <p className="-mt-2 mb-2 text-[11px] text-slate-500">
        <span className="font-semibold text-slate-700">{totalOpened}</span> opened ·{' '}
        <span className="font-semibold text-slate-700">{totalClosed}</span> closed ·{' '}
        <span className={`font-semibold ${net > 0 ? 'text-rose-700' : net < 0 ? 'text-emerald-700' : 'text-slate-500'}`}>
          {net > 0 ? `+${net}` : net} net
        </span>
      </p>
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#94a3b8" />
            <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" allowDecimals={false} />
            <Tooltip
              contentStyle={{ fontSize: 11, borderRadius: 6, border: '1px solid #e2e8f0' }}
              cursor={{ fill: '#f8fafc' }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
            <Bar dataKey="opened" name="Opened" fill="#f97316" radius={[3, 3, 0, 0]} />
            <Bar dataKey="closed" name="Closed" fill="#10b981" radius={[3, 3, 0, 0]} />
            <Line
              dataKey="net"
              name="Net (opened − closed)"
              stroke="#475569"
              strokeWidth={2}
              dot={{ r: 2.5 }}
              type="monotone"
            />
            <ReferenceLine y={0} stroke="#cbd5e1" strokeDasharray="2 4" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

// ─── MTTR by severity ───────────────────────────────────────────────────────

function MttrPanel({ data }: { data?: MttrRow[] }) {
  const filtered = (data ?? []).filter((d) => d.count > 0);
  if (filtered.length === 0) return <EmptyState label="No closures in the last 90 days" />;
  // We render a tidy horizontal bar so the severity labels stay legible.
  const max = Math.max(...filtered.map((d) => d.mean_days ?? 0), 1);
  return (
    <ul className="space-y-2.5 mt-1">
      {filtered.map((r) => {
        const pct = ((r.mean_days ?? 0) / max) * 100;
        return (
          <li key={r.severity}>
            <div className="flex items-center justify-between text-[11px]">
              <span className="inline-flex items-center gap-2 capitalize font-medium text-slate-700">
                <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />
                {r.severity}
                <span className="text-[10px] text-slate-400 font-normal">n={r.count}</span>
              </span>
              <span className="tabular-nums text-slate-800">
                <span className="font-semibold">{r.mean_days ?? '—'}</span>
                <span className="text-slate-400 ml-1">mean d</span>
                {r.median_days !== null && (
                  <span className="ml-2 text-[10px] text-slate-400">med {r.median_days}d</span>
                )}
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: r.color }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ─── Source donut ──────────────────────────────────────────────────────────

function SourcePanel({ data }: { data?: SourceRow[] }) {
  if (!data || data.length === 0) return <EmptyState label="No open issues yet" />;
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-center h-full">
      <div className="sm:col-span-2 h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data as unknown as Record<string, unknown>[]}
              dataKey="value"
              nameKey="name"
              innerRadius={42}
              outerRadius={72}
              paddingAngle={2}
              stroke="#fff"
              strokeWidth={2}
            >
              {data.map((d) => <Cell key={d.name} fill={d.color} />)}
            </Pie>
            <Tooltip
              contentStyle={{ fontSize: 11, borderRadius: 6, border: '1px solid #e2e8f0' }}
              // Default formatter shows "<value> : <name>" which is fine for
              // the donut — the per-slice critical breakdown lives in the
              // legend list to the right where it's always visible.
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="sm:col-span-3 space-y-1 max-h-[180px] overflow-y-auto pr-1">
        {data.map((d) => {
          const pct = total ? Math.round((d.value / total) * 100) : 0;
          return (
            <li key={d.name} className="flex items-center justify-between text-[11px]">
              <span className="inline-flex items-center gap-2 min-w-0">
                <span className="h-2 w-2 rounded-full shrink-0" style={{ background: d.color }} />
                <span className="truncate text-slate-700">{d.name}</span>
              </span>
              <span className="tabular-nums text-slate-800 ml-2 shrink-0">
                <span className="font-semibold">{d.value}</span>
                <span className="text-slate-400 ml-1">· {pct}%</span>
                {d.critical > 0 && (
                  <span className="ml-2 text-rose-700 font-semibold text-[10px]">{d.critical}c</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── Top assignees ─────────────────────────────────────────────────────────

function AssigneesPanel({ data }: { data?: AssigneeRow[] }) {
  if (!data || data.length === 0) return <EmptyState label="No assigned open issues yet" />;
  const chartData = data.map((d) => ({
    name: d.name.length > 16 ? d.name.slice(0, 14) + '…' : d.name,
    fullName: d.name,
    critical: d.critical,
    high: d.high,
    medium: d.medium,
    low: d.low,
    informational: d.informational,
  }));
  return (
    <div className="h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart layout="vertical" data={chartData} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 10 }} stroke="#94a3b8" allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 10 }}
            stroke="#94a3b8"
            width={86}
            interval={0}
          />
          <Tooltip
            contentStyle={{ fontSize: 11, borderRadius: 6, border: '1px solid #e2e8f0' }}
            cursor={{ fill: '#f8fafc' }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
          {SEVERITY_ORDER.map((sev) => (
            <Bar
              key={sev}
              dataKey={sev}
              stackId="severity"
              fill={SEVERITY_COLOR[sev]}
              name={sev.charAt(0).toUpperCase() + sev.slice(1)}
              radius={sev === 'critical' ? [0, 4, 4, 0] : 0}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── SLA compliance by severity ────────────────────────────────────────────

function SlaPanel({ data, reopen }: { data?: SlaRow[]; reopen?: ReopenStats }) {
  const filtered = (data ?? []).filter((d) => d.count > 0);
  // Reopen rate is auxiliary — always show, even when SLA panel has no data.
  const rr = reopen?.reopen_rate_pct;
  return (
    <div className="flex flex-col gap-3 h-full">
      {filtered.length === 0 ? (
        <EmptyState label="No closed issues with a target date yet" />
      ) : (
        <ul className="space-y-2 mt-1">
          {filtered.map((r) => {
            const pct = r.compliant_pct ?? 0;
            const tone =
              pct >= 95 ? '#10b981' :
              pct >= 80 ? '#f59e0b' :
              '#ef4444';
            return (
              <li key={r.severity}>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="inline-flex items-center gap-2 capitalize font-medium text-slate-700">
                    <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />
                    {r.severity}
                    <span className="text-[10px] text-slate-400 font-normal">n={r.count}</span>
                  </span>
                  <span className="tabular-nums">
                    <span className="font-semibold" style={{ color: tone }}>{pct}%</span>
                    <span className="text-slate-400 ml-1">on-time</span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(2, pct)}%`, background: tone }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-auto rounded-md border border-slate-200 bg-slate-50/60 p-2.5 flex items-center justify-between">
        <span className="text-[11px] font-medium text-slate-600 inline-flex items-center gap-1.5">
          <RotateCw className="h-3 w-3 text-slate-400" />
          Reopen rate
        </span>
        <span className="text-[11px] tabular-nums">
          {rr === null || rr === undefined ? (
            <span className="text-slate-400">—</span>
          ) : (
            <>
              <span
                className={`font-semibold ${
                  rr >= 10 ? 'text-rose-700' : rr >= 5 ? 'text-amber-700' : 'text-emerald-700'
                }`}
              >
                {rr}%
              </span>
              <span className="text-slate-400 ml-1">
                ({reopen?.reopen_count}/{reopen?.closed_total})
              </span>
            </>
          )}
        </span>
      </div>
    </div>
  );
}

// ─── Severity × Age heatmap ────────────────────────────────────────────────

function HeatmapPanel({ data }: { data?: HeatmapRow[] }) {
  if (!data || data.length === 0) return <EmptyState label="No open issues yet" />;
  const buckets = data[0]?.cells.map((c) => c.bucket) ?? [];
  const max = Math.max(1, ...data.flatMap((r) => r.cells.map((c) => c.count)));

  // Render a CSS-grid heatmap: row = severity, col = age bucket.
  // Cell intensity tracks count/max with the severity colour.
  return (
    <div className="grid gap-1.5 text-[11px]" style={{ gridTemplateColumns: `90px repeat(${buckets.length}, 1fr) 50px` }}>
      {/* Header row */}
      <div />
      {buckets.map((b) => (
        <div key={b} className="text-center text-[10px] uppercase tracking-wide text-slate-500 pb-1">
          {b}
        </div>
      ))}
      <div className="text-right text-[10px] uppercase tracking-wide text-slate-500 pb-1 pr-1">Total</div>

      {/* Data rows */}
      {data.map((row) => (
        <>
          <div key={`${row.severity}-label`} className="flex items-center gap-2 capitalize text-slate-700 font-medium">
            <span className="h-2 w-2 rounded-full" style={{ background: row.color }} />
            {row.severity}
          </div>
          {row.cells.map((c) => {
            const intensity = c.count === 0 ? 0 : 0.18 + 0.82 * (c.count / max);
            const isWarn = (row.severity === 'critical' || row.severity === 'high') && c.bucket === '>90d' && c.count > 0;
            return (
              <div
                key={`${row.severity}-${c.bucket}`}
                title={`${row.severity} · ${c.bucket} · ${c.count} open`}
                className={`rounded-md flex items-center justify-center h-9 text-[11px] font-semibold tabular-nums ${
                  c.count === 0 ? 'text-slate-300' : 'text-slate-900'
                } ${isWarn ? 'ring-2 ring-rose-400' : ''}`}
                style={{
                  background: c.count === 0 ? '#f8fafc' : hexToRgba(row.color, intensity),
                }}
              >
                {c.count || '·'}
              </div>
            );
          })}
          <div className="text-right text-slate-700 font-semibold tabular-nums pr-1 self-center">
            {row.total || <span className="text-slate-300">·</span>}
          </div>
        </>
      ))}
    </div>
  );
}

function hexToRgba(hex: string, alpha: number) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
}

// ─── Public component ───────────────────────────────────────────────────────

export function IssueAnalytics({ payload }: { payload: IssueAnalyticsPayload }) {
  // Compute a "should show anything" guard — when the tenant has literally
  // no issues, the parent (ClosureTracker) already renders an empty state,
  // but this component guards too in case it's reused elsewhere.
  const hasAny = useMemo(() => {
    return (
      (payload.trend_12w?.some((p) => p.opened || p.closed) ?? false) ||
      (payload.mttr_by_severity?.some((m) => m.count > 0) ?? false) ||
      (payload.by_source?.length ?? 0) > 0 ||
      (payload.top_assignees?.length ?? 0) > 0 ||
      (payload.severity_age_matrix?.some((r) => r.total > 0) ?? false)
    );
  }, [payload]);
  if (!hasAny) return null;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-3">
        <Panel
          icon={TrendingUp}
          title="Trend — Opened vs Closed"
          subtitle="Last 12 weeks · throughput view"
          className="lg:col-span-2"
        >
          <TrendPanel data={payload.trend_12w} />
        </Panel>
        <Panel
          icon={Activity}
          title="MTTR by Severity"
          subtitle="Mean / median days to close · last 90 days"
        >
          <MttrPanel data={payload.mttr_by_severity} />
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Panel
          icon={Layers}
          title="Sources"
          subtitle="Where open issues came from"
        >
          <SourcePanel data={payload.by_source} />
        </Panel>
        <Panel
          icon={Users}
          title="Top Assignees"
          subtitle="Open issues per owner · severity-stacked"
        >
          <AssigneesPanel data={payload.top_assignees} />
        </Panel>
        <Panel
          icon={Gauge}
          title="SLA Quality"
          subtitle="% of closures that hit the SLA · per severity"
        >
          <SlaPanel data={payload.sla_compliance_by_severity} reopen={payload.reopen_stats} />
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-1">
        <Panel
          icon={Grid3x3}
          title="Severity × Age — Open Issues"
          subtitle="Old + critical cells (highlighted rings) need eyes today"
        >
          <HeatmapPanel data={payload.severity_age_matrix} />
        </Panel>
      </div>
    </div>
  );
}
