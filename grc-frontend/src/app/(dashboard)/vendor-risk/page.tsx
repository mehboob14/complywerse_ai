'use client';

// TPRM Program Dashboard — the landing screen. Live KPI cards + charts driven by
// /vendor-risk/tpra/dashboard and /risk-trend. Role-aware (Portfolio vs my queue).
// Adapts the Sentinel-TPRM reference to the light Complyverse design system.

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ComposedChart, Area, Line, ReferenceLine, RadialBarChart, RadialBar, AreaChart,
} from 'recharts';
import {
  Building2, ShieldCheck, AlertTriangle, CalendarClock, TrendingDown, Plus,
  AlertCircle, ArrowUpRight, Radio, ArrowRight, ShieldAlert, CheckCircle2,
} from 'lucide-react';
import { tpraApi } from '@/lib/api';
import { PageLoader } from '@/components/ui';
import EmptyState from '@/components/common/EmptyState';
import {
  SEV_HEX, TIER_ORDER, DOMAIN_LABELS, sevBadgeCls, gradeColor, scoreColor, fmtDate, titleCase,
} from './_lib/tprmShared';

interface Kpis {
  active_vendors: number; onboarded_this_period: number; critical_coverage: number;
  critical_count: number; critical_covered: number; portfolio_inherent: number;
  portfolio_residual: number; open_critical_findings: number; open_critical_overdue: number;
  closure_rate: number; reviews_due_30d: number; overdue_reviews: number; new_signals: number;
}
interface Signal {
  id: number; vendor_id: number; vendor_name: string | null; signal_type: string;
  severity: string; title: string | null; occurred_at: string | null; acknowledged: boolean;
}
interface TopVendor {
  id: number; name: string; tier: string | null; residual: number | null;
  inherent: number | null; rating: string | null; grade: string | null;
}
interface Dashboard {
  scope: string; kpis: Kpis;
  tier_distribution: Record<string, number>;
  inherent_vs_residual: Array<{ tier: string; inherent: number; residual: number }>;
  findings_posture: Record<string, number>;
  findings_severity: Record<string, number>;
  findings_by_domain: Record<string, number>;
  monitoring_feed: Signal[];
  top_residual_vendors: TopVendor[];
}
interface Trend {
  appetite: number;
  series: Array<{ month: string; inherent: number | null; residual: number | null }>;
}

const POSTURE_HEX: Record<string, string> = {
  open: '#dc2626', in_remediation: '#f97316', accepted: '#64748b', closed: '#22c55e',
};
const POSTURE_LABEL: Record<string, string> = {
  open: 'Open', in_remediation: 'In Progress', accepted: 'Accepted', closed: 'Remediated',
};

function Panel({ title, sub, children, className }: { title: string; sub?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-4 ${className || ''}`}>
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

function KpiCard({
  label, value, icon: Icon, tone = 'slate', foot, spark,
}: {
  label: string; value: React.ReactNode; icon: typeof Building2; tone?: string;
  foot?: React.ReactNode; spark?: number[];
}) {
  const toneCls: Record<string, string> = {
    slate: 'text-slate-500', red: 'text-red-500', orange: 'text-orange-500',
    emerald: 'text-emerald-500', blue: 'text-primary-600', amber: 'text-amber-500',
  };
  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2 text-[11px] font-medium text-slate-500">
        <Icon className={`h-3.5 w-3.5 ${toneCls[tone]}`} /> {label}
      </div>
      <div className="mt-2 text-2xl font-bold text-slate-900">{value}</div>
      {foot && <div className="mt-1.5 text-[11px] text-slate-500">{foot}</div>}
      {spark && spark.length > 1 && (
        <div className="absolute right-3 top-3 h-8 w-16 opacity-80">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spark.map((v, i) => ({ i, v }))} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
              <Area type="monotone" dataKey="v" stroke="#1ed4b0" fill="#1ed4b0" fillOpacity={0.15} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ── Portfolio verdict banner ──────────────────────────────────────────────
// The board "is our third-party portfolio within appetite right now?" glance.
// Everything here is derived from data already fetched — no new endpoints.
function PortfolioVerdict({
  residual, inherent, appetite, tierData, overdueReviews, dueReviews, topVendors,
}: {
  residual: number;
  inherent: number;
  appetite: number | null;
  tierData: Array<{ name: string; key: string; value: number; color: string }>;
  overdueReviews: number;
  dueReviews: number;
  topVendors: TopVendor[];
}) {
  // Posture: within appetite (green) unless residual breaches, or is within 8
  // points of the appetite line (amber "watch"). No appetite → neutral read.
  const hasAppetite = appetite != null;
  const breach = hasAppetite && residual > appetite!;
  const watch = hasAppetite && !breach && residual >= appetite! - 8;
  const tone: 'ok' | 'watch' | 'breach' | 'neutral' = !hasAppetite
    ? 'neutral' : breach ? 'breach' : watch ? 'watch' : 'ok';

  const toneCfg = {
    ok: {
      band: 'border-emerald-200 bg-emerald-50/70', pill: 'bg-emerald-100 text-emerald-800',
      icon: CheckCircle2, iconCls: 'text-emerald-600',
      verdict: 'Within appetite', accent: 'text-emerald-700',
    },
    watch: {
      band: 'border-amber-200 bg-amber-50/70', pill: 'bg-amber-100 text-amber-800',
      icon: AlertTriangle, iconCls: 'text-amber-600',
      verdict: 'Approaching appetite', accent: 'text-amber-700',
    },
    breach: {
      band: 'border-red-200 bg-red-50/70', pill: 'bg-red-100 text-red-800',
      icon: ShieldAlert, iconCls: 'text-red-600',
      verdict: 'Over appetite', accent: 'text-red-700',
    },
    neutral: {
      band: 'border-slate-200 bg-slate-50', pill: 'bg-slate-100 text-slate-700',
      icon: ShieldCheck, iconCls: 'text-slate-500',
      verdict: 'Appetite not set', accent: 'text-slate-700',
    },
  }[tone];
  const VerdictIcon = toneCfg.icon;
  const headline = hasAppetite
    ? `Portfolio residual ${residual} vs appetite ${appetite}`
    : `Portfolio residual ${residual}`;
  const gap = hasAppetite ? residual - appetite! : null;

  return (
    <section
      aria-label="Portfolio posture"
      className={`rounded-xl border ${toneCfg.band} p-4`}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        {/* Verdict */}
        <div className="flex items-start gap-3">
          <span className={`mt-0.5 ${toneCfg.iconCls}`}>
            <VerdictIcon className="h-7 w-7" strokeWidth={1.75} />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${toneCfg.pill}`}>
                {toneCfg.verdict}
              </span>
              {gap != null && (
                <span className={`text-xs font-medium ${toneCfg.accent}`}>
                  {gap > 0 ? `${gap} over the line` : gap === 0 ? 'on the line' : `${Math.abs(gap)} of headroom`}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm font-semibold text-slate-900">{headline}</p>
            <p className="text-xs text-slate-500">
              {Math.max(0, Math.round(inherent - residual))} points of risk removed by controls · inherent {inherent}
            </p>
          </div>
        </div>

        {/* At-a-glance stats */}
        <div className="grid grid-cols-3 gap-4 border-t border-slate-200/70 pt-3 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Tier mix</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {tierData.length === 0 ? (
                <span className="text-xs text-slate-400">—</span>
              ) : tierData.map((t) => (
                <span key={t.key} className="inline-flex items-center gap-1 text-xs font-medium text-slate-700">
                  <span className="h-2 w-2 rounded-sm" style={{ background: t.color }} />
                  {t.value} {t.name}
                </span>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Reviews</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">
              {overdueReviews > 0
                ? <span className="text-orange-600">{overdueReviews} overdue</span>
                : <span className="text-emerald-600">None overdue</span>}
            </div>
            <div className="text-[11px] text-slate-500">{dueReviews} due ≤30d</div>
          </div>
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Top residual</div>
            {topVendors.length === 0 ? (
              <div className="mt-1 text-xs text-slate-400">No scored vendors</div>
            ) : (
              <ul className="mt-1 space-y-0.5">
                {topVendors.slice(0, 2).map((v) => (
                  <li key={v.id} className="flex items-center gap-1.5 text-xs">
                    <span className="truncate font-medium text-slate-700">{v.name}</span>
                    <span className="ml-auto font-mono font-semibold" style={{ color: scoreColor(v.residual) }}>
                      {v.residual ?? '—'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function VendorRiskDashboardPage() {
  const router = useRouter();
  const [scope, setScope] = useState<'portfolio' | 'mine'>('portfolio');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['tprm-dashboard', scope],
    queryFn: async () => (await tpraApi.dashboard(scope)).data as Dashboard,
  });
  const { data: trend } = useQuery({
    queryKey: ['tprm-trend'],
    queryFn: async () => (await tpraApi.riskTrend({ scope: 'portfolio', months: 12 })).data as Trend,
  });

  if (isLoading) return <div className="flex h-72 items-center justify-center"><PageLoader size="md" label="Loading program dashboard…" /></div>;
  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-red-500">
        <AlertCircle className="mb-2 h-8 w-8" />
        <p className="text-sm">Failed to load the dashboard.</p>
        <button onClick={() => refetch()} className="mt-2 text-xs font-medium text-primary-600 hover:underline">Retry</button>
      </div>
    );
  }
  if (!data) return null;
  const k = data.kpis;

  if (k.active_vendors === 0) {
    return (
      <EmptyState
        icon={<Building2 className="h-7 w-7" />}
        title="No vendors yet"
        description="Add your first third party to start the TPRM lifecycle. The dashboard comes alive as you onboard vendors, run assessments and capture monitoring signals."
        primaryAction={{ label: 'Add vendor', href: '/vendor-risk/vendors' }}
      />
    );
  }

  // ── chart datasets ──
  const tierData = TIER_ORDER
    .map((t) => ({ name: titleCase(t), key: t, value: data.tier_distribution[t] || 0, color: SEV_HEX[t] }))
    .filter((d) => d.value > 0);
  const inhRes = data.inherent_vs_residual.map((r) => ({ tier: titleCase(r.tier), inherent: r.inherent, residual: r.residual }));
  const postureData = Object.entries(data.findings_posture)
    .map(([key, value]) => ({ key, name: POSTURE_LABEL[key] || titleCase(key), value, color: POSTURE_HEX[key] || '#94a3b8' }))
    .filter((d) => d.value > 0);
  const domainData = Object.entries(data.findings_by_domain)
    .map(([key, value]) => ({ name: DOMAIN_LABELS[key] || titleCase(key), value }))
    .sort((a, b) => b.value - a.value).slice(0, 8);
  const trendSeries = (trend?.series || []).map((s) => ({
    month: s.month.slice(2), inherent: s.inherent, residual: s.residual,
  }));
  const residualGauge = [{ name: 'residual', value: k.portfolio_residual, fill: scoreColor(k.portfolio_residual) }];
  const riskRemoved = Math.max(0, Math.round(k.portfolio_inherent - k.portfolio_residual));

  return (
    <div className="space-y-4">
      {/* Header + role scope toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Program Dashboard</h1>
          <p className="text-sm text-slate-500">Third-party risk posture across the portfolio — live from assessments, findings and monitoring.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 text-xs font-medium" role="tablist" aria-label="Dashboard scope">
            {(['portfolio', 'mine'] as const).map((s) => (
              <button key={s} role="tab" aria-selected={scope === s} onClick={() => setScope(s)}
                className={`rounded-md px-2.5 py-1 ${scope === s ? 'bg-primary-600 text-[#0a0a0a]' : 'text-slate-600 hover:bg-slate-50'}`}>
                {s === 'portfolio' ? 'Portfolio' : 'My queue'}
              </button>
            ))}
          </div>
          <Link href="/vendor-risk/vendors" className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-[#0a0a0a] hover:bg-primary-700">
            <Plus className="h-3.5 w-3.5" /> Add vendor
          </Link>
        </div>
      </div>

      {/* Portfolio verdict — board 30-second read, above the operational widgets */}
      <PortfolioVerdict
        residual={k.portfolio_residual}
        inherent={k.portfolio_inherent}
        appetite={trend?.appetite ?? null}
        tierData={tierData}
        overdueReviews={k.overdue_reviews}
        dueReviews={k.reviews_due_30d}
        topVendors={data.top_residual_vendors}
      />

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard label="Active vendors" value={k.active_vendors} icon={Building2} tone="blue"
          foot={k.onboarded_this_period > 0 ? <span className="text-emerald-600">+{k.onboarded_this_period} onboarded · 30d</span> : 'No new onboards · 30d'} />
        <KpiCard label="Critical coverage" value={`${k.critical_coverage}%`} icon={ShieldCheck}
          tone={k.critical_coverage >= 90 ? 'emerald' : 'amber'}
          foot={`${k.critical_covered}/${k.critical_count} critical vendors assessed`} />
        <KpiCard label="Portfolio residual" value={k.portfolio_residual} icon={TrendingDown} tone="emerald"
          foot={<span><span className="font-medium text-slate-600">{riskRemoved}</span> removed vs inherent {k.portfolio_inherent}</span>}
          spark={trendSeries.map((s) => s.residual ?? 0)} />
        <KpiCard label="Open critical findings" value={k.open_critical_findings} icon={AlertTriangle}
          tone={k.open_critical_findings ? 'red' : 'emerald'}
          foot={<span>{k.open_critical_overdue > 0 ? <span className="text-red-600">{k.open_critical_overdue} past SLA</span> : 'On track'} · {k.closure_rate}% closure</span>} />
        <KpiCard label="Reviews due ≤30d" value={k.reviews_due_30d} icon={CalendarClock}
          tone={k.overdue_reviews ? 'orange' : 'slate'}
          foot={<span>{k.overdue_reviews > 0 && <span className="text-orange-600">{k.overdue_reviews} overdue · </span>}{k.new_signals} new signals</span>} />
      </div>

      {/* Row: tier donut · inherent-vs-residual · residual gauge */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Vendor risk-tier distribution" sub="Inherent tier across active vendors">
          <div className="flex items-center gap-4">
            <ResponsiveContainer width="55%" height={170}>
              <PieChart>
                <Pie data={tierData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={2}>
                  {tierData.map((d) => <Cell key={d.key} fill={d.color} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-1.5">
              {tierData.map((d) => (
                <div key={d.key} className="flex items-center gap-2 text-xs">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: d.color }} />
                  <span className="text-slate-600">{d.name}</span>
                  <span className="ml-auto font-mono font-semibold text-slate-800">{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        <Panel title="Inherent vs residual by tier" sub="The gap is the risk removed by controls">
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={inhRes} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef1f5" vertical={false} />
              <XAxis dataKey="tier" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="inherent" name="Inherent" fill="#94a3b8" radius={[3, 3, 0, 0]} />
              <Bar dataKey="residual" name="Residual" fill="#1ed4b0" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Portfolio residual" sub="Average residual across the portfolio">
          <div className="relative">
            <ResponsiveContainer width="100%" height={170}>
              <RadialBarChart innerRadius="70%" outerRadius="100%" data={residualGauge} startAngle={180} endAngle={0}>
                <RadialBar background dataKey="value" cornerRadius={8} />
              </RadialBarChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-x-0 bottom-8 text-center">
              <div className="text-3xl font-bold" style={{ color: scoreColor(k.portfolio_residual) }}>{k.portfolio_residual}</div>
              <div className="text-[11px] text-slate-500">/ 100 residual · inherent {k.portfolio_inherent}</div>
            </div>
          </div>
        </Panel>
      </div>

      {/* Risk trend over time */}
      <Panel title="Portfolio risk trend" sub="Inherent vs residual over time, against the risk-appetite line">
        {trendSeries.length === 0 ? (
          <p className="py-8 text-center text-xs text-slate-400">No snapshot history yet — the trend builds as assessments are scored.</p>
        ) : (
          <ResponsiveContainer width="100%" height={230}>
            <ComposedChart data={trendSeries} margin={{ top: 6, right: 10, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="resfill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1ed4b0" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#1ed4b0" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef1f5" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {trend?.appetite != null && (
                <ReferenceLine y={trend.appetite} stroke="#f97316" strokeDasharray="5 4"
                  label={{ value: `Appetite ${trend.appetite}`, position: 'insideTopRight', fontSize: 10, fill: '#f97316' }} />
              )}
              <Area type="monotone" dataKey="residual" name="Residual" stroke="#1ed4b0" fill="url(#resfill)" strokeWidth={2.4} />
              <Line type="monotone" dataKey="inherent" name="Inherent" stroke="#94a3b8" strokeWidth={2} dot={false} strokeDasharray="5 4" />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </Panel>

      {/* Row: findings posture · findings by domain */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Findings posture" sub="Status mix + severity breakdown">
          <div className="flex items-center gap-4">
            <ResponsiveContainer width="48%" height={160}>
              <PieChart>
                <Pie data={postureData} dataKey="value" nameKey="name" innerRadius={40} outerRadius={64} paddingAngle={2}>
                  {postureData.map((d) => <Cell key={d.key} fill={d.color} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-2">
              {postureData.map((d) => (
                <div key={d.key} className="flex items-center gap-2 text-xs">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: d.color }} />
                  <span className="text-slate-600">{d.name}</span>
                  <span className="ml-auto font-mono font-semibold text-slate-800">{d.value}</span>
                </div>
              ))}
              <div className="mt-2 flex flex-wrap gap-1.5 border-t border-slate-100 pt-2">
                {TIER_ORDER.map((s) => (
                  <span key={s} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${sevBadgeCls(s)}`}>
                    {titleCase(s)} {data.findings_severity[s] || 0}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Open findings by risk domain" sub="Where the open gaps concentrate">
          {domainData.length === 0 ? (
            <p className="py-10 text-center text-xs text-slate-400">No open findings.</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(140, domainData.length * 26)}>
              <BarChart data={domainData} layout="vertical" margin={{ top: 0, right: 12, left: 8, bottom: 0 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip />
                <Bar dataKey="value" name="Open findings" fill="#f97316" radius={[0, 4, 4, 0]} barSize={12} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>
      </div>

      {/* Row: monitoring feed · top-residual vendors */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Live monitoring feed" sub="Latest outside-in signals — click through to the vendor">
          {data.monitoring_feed.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-400">No monitoring signals.</p>
          ) : (
            <div className="space-y-1">
              {data.monitoring_feed.slice(0, 8).map((s) => (
                <button key={s.id} onClick={() => router.push(`/vendor-risk/vendors/${s.vendor_id}`)}
                  className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-slate-50">
                  <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full" style={{ background: SEV_HEX[s.severity] || '#94a3b8' }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-slate-800">{s.title || titleCase(s.signal_type)}</p>
                    <p className="text-[11px] text-slate-500">{s.vendor_name} · {titleCase(s.signal_type)} · {fmtDate(s.occurred_at)}</p>
                  </div>
                  {!s.acknowledged && <span className="mt-0.5 rounded-full bg-primary-50 px-1.5 py-0.5 text-[10px] font-medium text-primary-700">new</span>}
                </button>
              ))}
              <Link href="/vendor-risk/monitoring" className="mt-1 flex items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-medium text-primary-600 hover:bg-primary-50">
                <Radio className="h-3.5 w-3.5" /> View all signals <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          )}
        </Panel>

        <Panel title="Highest-residual vendors" sub="Ranked by residual risk — click through to the profile">
          {data.top_residual_vendors.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-400">No scored vendors yet.</p>
          ) : (
            <div className="space-y-1.5">
              {data.top_residual_vendors.map((v) => (
                <button key={v.id} onClick={() => router.push(`/vendor-risk/vendors/${v.id}`)}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-slate-50">
                  <span className={`font-mono text-base font-bold ${gradeColor(v.grade)}`}>{v.grade || '—'}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-slate-800">{v.name}</p>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, v.residual ?? 0)}%`, background: scoreColor(v.residual) }} />
                    </div>
                  </div>
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${sevBadgeCls(v.tier)}`}>{titleCase(v.tier)}</span>
                  <span className="w-8 text-right font-mono text-xs font-semibold text-slate-700">{v.residual ?? '—'}</span>
                  <ArrowUpRight className="h-3.5 w-3.5 text-slate-400" />
                </button>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
