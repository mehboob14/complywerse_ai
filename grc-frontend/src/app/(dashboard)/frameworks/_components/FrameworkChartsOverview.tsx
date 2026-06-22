'use client';

// Framework compliance dashboard charts for the detail page (/frameworks/[id]).
// Mirrors the light-theme recharts style used by ComplianceDashboard:
//   • top stat cards (in-scope / automated / ready-to-audit)
//   • completion gauge + requirement-status donut
//   • automated-controls assurance donut + maturity radar (by domain)
//   • compliance trend (completion & readiness over time)
// Data: GET /certifications/{id}/charts (also records today's posture snapshot).

import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer,
  RadialBarChart, RadialBar, PolarAngleAxis,
  PieChart, Pie, Cell, Tooltip,
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  RadarChart, PolarGrid, Radar,
} from 'recharts';
import { Layers3, Cast, ShieldCheck, Gauge, PieChart as PieIcon, Radar as RadarIcon, TrendingUp } from 'lucide-react';
import { certificationsApi } from '@/lib/api';

type ChartsData = {
  gauge: { completion_pct: number; readiness_pct: number; evidence_coverage_pct: number };
  stats: {
    total_in_scope: number; applicable: number; not_applicable: number; implemented: number;
    ready_to_audit: number; with_evidence: number; automated: number; automated_passed: number;
  };
  status_donut: Array<{ key: string; label: string; value: number; color: string }>;
  automation_donut: Array<{ label: string; value: number; color: string }>;
  maturity: Array<{ label: string; value: number; maxValue: number }>;
  trend: Array<{ label: string; completion: number; readiness: number }>;
};

function Card({ title, icon, children, className = '' }: { title: string; icon: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 ring-1 ring-blue-100">{icon}</div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function StatCard({ icon, label, value, sub, accent }: { icon: React.ReactNode; label: string; value: string | number; sub?: string; accent: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-slate-500">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${accent}`}>{icon}</span>
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-2xl font-bold tabular-nums text-slate-900">{value}</span>
        {sub && <span className="text-[11px] text-slate-500">{sub}</span>}
      </div>
    </div>
  );
}

function gaugeColor(pct: number): string {
  if (pct >= 75) return '#10b981';
  if (pct >= 40) return '#f59e0b';
  return '#ef4444';
}

export function FrameworkChartsOverview({ journeyId }: { journeyId: number }) {
  const { data, isLoading, error } = useQuery<ChartsData>({
    queryKey: ['framework-charts', journeyId],
    queryFn: async () => (await certificationsApi.getCharts(journeyId)).data as ChartsData,
    enabled: !!journeyId,
    refetchInterval: 60000,
  });

  if (isLoading) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Loading compliance charts…</div>;
  }
  if (error || !data) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Compliance charts unavailable.</div>;
  }

  const { gauge, stats, status_donut, automation_donut, maturity, trend } = data;
  const completion = Math.round(gauge.completion_pct);
  const gColor = gaugeColor(completion);

  return (
    <div className="space-y-4">
      {/* Top stat cards — match the reference: In-scope (green) · Automated
          (amber) · Ready to Audit (red), professional icons. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard icon={<Layers3 className="h-5 w-5 text-emerald-600" />} label="Total Requirements In-scope"
          value={stats.total_in_scope} sub={stats.not_applicable ? `${stats.not_applicable} N/A` : undefined}
          accent="bg-emerald-50 ring-1 ring-emerald-100" />
        <StatCard icon={<Cast className="h-5 w-5 text-amber-600" />} label="of Requirements Automated"
          value={`${stats.automated} / ${stats.total_in_scope}`} sub={stats.automated ? `${stats.automated_passed} passing` : undefined}
          accent="bg-amber-50 ring-1 ring-amber-100" />
        <StatCard icon={<ShieldCheck className="h-5 w-5 text-rose-600" />} label="of Requirements Ready to Audit"
          value={`${stats.ready_to_audit} / ${stats.total_in_scope}`} sub="approved evidence"
          accent="bg-rose-50 ring-1 ring-rose-100" />
      </div>

      {/* Gauge + status donut */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Overall Compliance" icon={<Gauge className="h-3.5 w-3.5 text-blue-600" />}>
          <div className="flex items-center gap-4">
            <div className="relative h-[170px] w-[170px] shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart innerRadius="78%" outerRadius="100%" data={[{ value: completion }]} startAngle={90} endAngle={-270}>
                  <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                  <RadialBar dataKey="value" cornerRadius={10} fill={gColor} background={{ fill: '#f1f5f9' }} />
                </RadialBarChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-4xl font-bold tabular-nums" style={{ color: gColor }}>{completion}%</span>
                <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-500">Compliant</span>
                <span className="mt-1 text-[10px] text-slate-500">{stats.implemented} of {stats.applicable}</span>
              </div>
            </div>
            <div className="flex-1 space-y-2">
              <Bar label="Readiness" value={Math.round(gauge.readiness_pct)} color="#10b981" />
              <Bar label="Evidence coverage" value={Math.round(gauge.evidence_coverage_pct)} color="#3b82f6" />
              <Bar label="Compliant" value={completion} color={gColor} />
            </div>
          </div>
        </Card>

        <Card title="Requirement Status" icon={<PieIcon className="h-3.5 w-3.5 text-blue-600" />}>
          {status_donut.length > 0 ? (
            <DonutWithLegend data={status_donut} centerValue={stats.applicable} centerLabel="in scope" />
          ) : <EmptyChart />}
        </Card>
      </div>

      {/* Automation assurance + maturity radar */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Automated Controls Assurance" icon={<Cast className="h-3.5 w-3.5 text-blue-600" />}>
          {automation_donut.some((d) => d.value > 0) ? (
            <DonutWithLegend data={automation_donut.map((d, i) => ({ ...d, key: String(i) }))} centerValue={`${stats.automated}`} centerLabel="automated" />
          ) : (
            <div className="py-10 text-center text-xs text-slate-400">
              No requirements are linked to a compliance plugin yet.<br />Map plugins to controls to populate automation.
            </div>
          )}
        </Card>

        <Card title="Maturity by Domain" icon={<RadarIcon className="h-3.5 w-3.5 text-blue-600" />}>
          {maturity.length >= 3 ? (
            <ResponsiveContainer width="100%" height={240}>
              <RadarChart data={maturity} outerRadius="72%">
                <PolarGrid stroke="#e2e8f0" />
                <PolarAngleAxis dataKey="label" tick={{ fontSize: 9, fill: '#64748b' }} />
                <Radar dataKey="value" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.35} />
                <Tooltip formatter={(v: any) => [`${v}%`, 'Completion']} />
              </RadarChart>
            </ResponsiveContainer>
          ) : (
            <div className="py-10 text-center text-xs text-slate-400">Needs at least 3 domains to render a radar.</div>
          )}
        </Card>
      </div>

      {/* Compliance trend */}
      <Card title="Compliance Trend" icon={<TrendingUp className="h-3.5 w-3.5 text-blue-600" />}>
        {trend.length >= 2 ? (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={trend} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="ctComp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#64748b' }} unit="%" />
              <Tooltip formatter={(v: any, n: any) => [`${v}%`, n === 'completion' ? 'Compliant' : 'Readiness']} />
              <Area type="monotone" dataKey="completion" stroke="#3b82f6" strokeWidth={2} fill="url(#ctComp)" />
              <Area type="monotone" dataKey="readiness" stroke="#10b981" strokeWidth={2} fill="none" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="py-8 text-center text-xs text-slate-400">
            Trend builds up over time — only {trend.length} data point so far. Check back as the posture changes day to day.
          </div>
        )}
      </Card>
    </div>
  );
}

function Bar({ label, value, color }: { label: string; value: number; color: string }) {
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

function DonutWithLegend({ data, centerValue, centerLabel }: { data: Array<{ label: string; value: number; color: string; key?: string }>; centerValue: string | number; centerLabel: string }) {
  return (
    <div className="grid items-center gap-3 sm:grid-cols-[180px_1fr]">
      <div className="relative h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" cx="50%" cy="50%" innerRadius={56} outerRadius={84} paddingAngle={2} stroke="#fff" strokeWidth={2}>
              {data.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Pie>
            <Tooltip formatter={(v: any, n: any) => [v, n]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-2xl font-bold tabular-nums text-slate-900">{centerValue}</span>
          <span className="text-[10px] uppercase tracking-wider text-slate-500">{centerLabel}</span>
        </div>
      </div>
      <div className="space-y-1.5">
        {data.filter((d) => d.value > 0).map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.color }} />
            <span className="flex-1 text-slate-600">{d.label}</span>
            <span className="font-semibold tabular-nums text-slate-800">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyChart() {
  return <div className="py-10 text-center text-xs text-slate-400">No requirement status data yet.</div>;
}
