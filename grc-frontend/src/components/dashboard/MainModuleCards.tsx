'use client';

/**
 * Main dashboard — module aggregation. One card per major module, each with a
 * chart matched to its data (radar for multi-dimension score modules, target
 * columns for others, donuts for count modules). Modules without a KPI score
 * endpoint still get a count-based fallback card that links to the module.
 */

import { useQueries, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import apiClient from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { scoreBand, ScoreRing } from '@/components/dashboard/score-kit';
import {
  RadarChart, PolarGrid, PolarAngleAxis, Radar,
  BarChart, Bar, XAxis, YAxis, Cell, LabelList, ReferenceLine,
  PieChart, Pie, ResponsiveContainer, Tooltip,
} from 'recharts';
import {
  Landmark, ShieldCheck, Scale, ClipboardCheck, Server, ListTodo,
  BadgeCheck, ArrowRight, Gauge, AlertTriangle, Layers, Flame,
  Shield, LifeBuoy,
} from 'lucide-react';
import { SCORECARD_QUERY_KEYS } from '@/components/dashboard/scorecard-query-keys';

type Sub = { label: string; score?: number | null };
type Seg = { label: string; value: number; color: string };
type Viz = 'radar' | 'bars' | 'donut';
type Card = {
  score: number | null;
  subs: Sub[];
  segs?: Seg[];
  total?: number;
  note?: string | null;
  pastSla?: number;
  hasData?: boolean;
};

type ModuleDef = {
  key: string;
  label: string;
  href: string;
  Icon: typeof Gauge;
  viz: Viz;
  path: string;
  /** Shared with the module scorecard page — same key = same cached score. */
  queryKey?: readonly unknown[];
  requiredPermissions?: string[];
  map: (d: any) => Card;
};

const r0 = (v: number) => Math.round(v);
const hex = (s?: number | null) => scoreBand(s).hex;
const short = (s: string, n = 11) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

const SEG_COLORS = ['#0d9488', '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#ca8a04', '#64748b'];

const dictSegs = (obj?: Record<string, number> | null, max = 5): Seg[] => {
  if (!obj) return [];
  return Object.entries(obj)
    .filter(([, v]) => (v ?? 0) > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([label, value], i) => ({
      label: label.replace(/_/g, ' '),
      value,
      color: SEG_COLORS[i % SEG_COLORS.length],
    }));
};

const sectionSubs = (d: any): Sub[] => {
  const comps: any[] = d?.performance?.components ?? Object.values(d?.sections ?? {});
  return (comps || [])
    .filter((c) => c && c.label)
    .map((c) => ({ label: c.label as string, score: (c.score ?? null) as number | null }))
    .sort((a, b) => (a.score ?? 999) - (b.score ?? 999))
    .slice(0, 6);
};

const MODULES: ModuleDef[] = [
  {
    key: 'governance', label: 'Governance', href: '/governance', Icon: Landmark, viz: 'radar',
    path: '/governance/dashboard/documents-overview',
    queryKey: SCORECARD_QUERY_KEYS.governance,
    requiredPermissions: ['governance:policies:*'],
    map: (d) => ({ score: d?.performance?.score ?? null, subs: sectionSubs(d), hasData: d?.performance?.score != null }),
  },
  {
    key: 'compliance', label: 'Compliance', href: '/compliance', Icon: ShieldCheck, viz: 'bars',
    path: '/compliance/policies/dashboard/sections-overview',
    queryKey: SCORECARD_QUERY_KEYS.compliance,
    requiredPermissions: ['compliance:frameworks:*', 'controls:control_library:*'],
    map: (d) => ({ score: d?.performance?.score ?? null, subs: sectionSubs(d), hasData: d?.performance?.score != null }),
  },
  {
    key: 'assessments', label: 'Assessments', href: '/assessments', Icon: ClipboardCheck, viz: 'bars',
    path: '/compliance/assessments/overview',
    queryKey: SCORECARD_QUERY_KEYS.assessments,
    requiredPermissions: ['compliance:assessments:*'],
    map: (d) => ({
      score: d?.performance?.score ?? null,
      subs: (d?.categories ?? []).map((c: any) => ({ label: c.category, score: c.score })).sort((a: Sub, b: Sub) => (a.score ?? 999) - (b.score ?? 999)),
      pastSla: d?.attention?.overdue_gaps ?? 0,
      hasData: d?.performance?.score != null || (d?.categories?.length ?? 0) > 0,
    }),
  },
  {
    key: 'assets', label: 'Assets', href: '/assets', Icon: Server, viz: 'radar',
    path: '/assets/inventory-overview',
    queryKey: SCORECARD_QUERY_KEYS.assets,
    requiredPermissions: ['assets:asset_inventory:*'],
    map: (d) => ({ score: d?.performance?.score ?? null, subs: sectionSubs(d), hasData: d?.performance?.score != null }),
  },
  {
    key: 'issues', label: 'Issues & Incidents', href: '/issues', Icon: ListTodo, viz: 'bars',
    path: '/issue-management/dashboard/sections-overview',
    queryKey: SCORECARD_QUERY_KEYS.issues,
    requiredPermissions: ['issue_management:issues:*', 'erm:incidents:*'],
    map: (d) => {
      const subs = sectionSubs(d);
      const issueTotal = d?.sections?.issues?.counts?.total ?? 0;
      const incidentTotal = d?.sections?.incidents?.counts?.total ?? 0;
      const hasSectionScores = subs.some((s) => s.score != null);
      const hasRecords = issueTotal > 0 || incidentTotal > 0;
      return {
        score: d?.performance?.score ?? null,
        subs,
        pastSla: d?.attention_queue?.sla_breached_issues ?? 0,
        note: (d?.attention_queue?.open_critical_incidents ?? 0) > 0
          ? `${d.attention_queue.open_critical_incidents} critical incident${d.attention_queue.open_critical_incidents === 1 ? '' : 's'}`
          : hasRecords && d?.performance?.score == null
            ? `${issueTotal} issue${issueTotal === 1 ? '' : 's'} · ${incidentTotal} incident${incidentTotal === 1 ? '' : 's'}`
            : null,
        hasData: d?.performance?.score != null || hasSectionScores || hasRecords,
        segs: hasRecords && !hasSectionScores
          ? [
              ...(issueTotal > 0 ? [{ label: 'Issues', value: issueTotal, color: SEG_COLORS[0] }] : []),
              ...(incidentTotal > 0 ? [{ label: 'Incidents', value: incidentTotal, color: SEG_COLORS[1] }] : []),
            ]
          : undefined,
        total: issueTotal + incidentTotal,
      };
    },
  },
  {
    key: 'assurance', label: 'Control Testing & Assurance', href: '/control-library/assurance', Icon: BadgeCheck, viz: 'bars',
    path: '/control-library/assurance/sections-overview',
    queryKey: SCORECARD_QUERY_KEYS.assurance,
    requiredPermissions: ['controls:control_library:*'],
    map: (d) => {
      const subs = sectionSubs(d);
      const aq = d?.attention_queue ?? {};
      const active = d?.sections?.coverage?.counts?.active ?? 0;
      const overdue = aq.overdue_control_tests ?? 0;
      const untested = aq.controls_untested ?? 0;
      return {
        score: d?.performance?.score ?? null,
        subs,
        pastSla: overdue,
        note: overdue > 0
          ? `${overdue} overdue test${overdue === 1 ? '' : 's'}`
          : untested > 0
            ? `${untested} untested control${untested === 1 ? '' : 's'}`
            : active > 0
              ? `${active} active control${active === 1 ? '' : 's'}`
              : null,
        hasData: d?.performance?.score != null || active > 0 || subs.some((s) => s.score != null),
      };
    },
  },
  {
    key: 'frameworks', label: 'Frameworks', href: '/frameworks/manage', Icon: Layers, viz: 'donut',
    path: '/compliance/policies/dashboard/frameworks-aggregate',
    requiredPermissions: ['compliance:frameworks:*'],
    map: (d) => {
      const journeys = d?.by_framework ?? [];
      const segs = (d?.status_mix ?? []).map((s: any, i: number) => ({
        label: s.name, value: s.value, color: s.color || SEG_COLORS[i % SEG_COLORS.length],
      }));
      const names = journeys
        .map((j: any) => j.framework_name || j.name)
        .filter(Boolean)
        .slice(0, 2);
      return {
        score: null,
        subs: [],
        segs,
        total: journeys.length,
        note: journeys.length
          ? names.length
            ? `${journeys.length} journeys · ${names.join(', ')}${journeys.length > names.length ? '…' : ''}`
            : `${journeys.length} certification journeys`
          : null,
        hasData: journeys.length > 0,
      };
    },
  },
  {
    key: 'vendor-risk', label: 'Third-Party Vendor Risk', href: '/vendor-risk', Icon: Shield, viz: 'donut',
    path: '/vendor-risk/vendors/dashboard',
    requiredPermissions: ['erm:risks:*'],
    map: (d) => {
      const segs = dictSegs(d?.by_tier ?? d?.by_status);
      const expiring = d?.expiring_contracts?.length ?? 0;
      return {
        score: null,
        subs: [],
        segs,
        total: d?.total_vendors ?? 0,
        note: (d?.open_incidents ?? 0) > 0
          ? `${d.open_incidents} open incidents`
          : expiring > 0
            ? `${expiring} contract${expiring === 1 ? '' : 's'} expiring`
            : null,
        hasData: (d?.total_vendors ?? 0) > 0,
      };
    },
  },
  {
    key: 'bcm', label: 'Business Continuity', href: '/bcm', Icon: LifeBuoy, viz: 'donut',
    path: '/bcm/dashboard',
    requiredPermissions: ['bcm:dashboard:*', 'bcm:plans:*'],
    map: (d) => ({
      score: null,
      subs: [],
      segs: dictSegs(d?.plans_by_status ?? d?.drills_by_status),
      total: d?.totals?.plans ?? 0,
      note: (d?.totals?.overdue_drills ?? 0) > 0
        ? `${d.totals.overdue_drills} overdue drill${d.totals.overdue_drills === 1 ? '' : 's'}`
        : (d?.totals?.active_plans ?? 0) > 0
          ? `${d.totals.active_plans} active plan${d.totals.active_plans === 1 ? '' : 's'}`
          : null,
      hasData: (d?.totals?.plans ?? 0) > 0 || (d?.totals?.drills ?? 0) > 0,
    }),
  },
];

/* ---------- mini charts ---------- */

function RadarViz({ subs, tone }: { subs: Sub[]; tone: string }) {
  const data = subs.map((s) => ({ axis: short(s.label, 12), full: s.label, value: s.score ?? 0 }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <RadarChart data={data} outerRadius="72%" margin={{ top: 6, right: 22, bottom: 6, left: 22 }}>
        <PolarGrid stroke="#e2e8f0" />
        <PolarAngleAxis dataKey="axis" tick={{ fontSize: 9, fill: '#64748b' }} />
        <Radar dataKey="value" stroke={tone} fill={tone} fillOpacity={0.28} strokeWidth={2} />
        <Tooltip
          contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0', padding: '4px 8px' }}
          formatter={(v: any, _n: any, p: any) => [`${r0(v)}%`, p?.payload?.full]}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}

function BarsViz({ subs }: { subs: Sub[] }) {
  const data = subs.map((s) => ({ name: s.label, value: r0(s.score ?? 0) }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 30, bottom: 4, left: 4 }} barCategoryGap="26%">
        <XAxis type="number" domain={[0, 100]} hide />
        <YAxis type="category" dataKey="name" width={108} tick={{ fontSize: 10, fill: '#475569' }} axisLine={false} tickLine={false} interval={0} />
        <ReferenceLine x={85} stroke="#94a3b8" strokeDasharray="3 3" strokeWidth={1} />
        <Tooltip
          cursor={{ fill: '#f1f5f9' }}
          contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0', padding: '4px 8px' }}
          formatter={(v: any) => [`${v}%`, 'Score']}
        />
        <Bar dataKey="value" radius={[0, 3, 3, 0]} maxBarSize={16}>
          {data.map((d, i) => <Cell key={i} fill={hex(d.value)} />)}
          <LabelList dataKey="value" position="right" fontSize={10} fontWeight={600} fill="#475569" formatter={(v: any) => `${v}%`} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function DonutViz({ segs, total, centerLabel }: { segs: Seg[]; total: number; centerLabel: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative h-[118px] w-[118px] flex-shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={segs} dataKey="value" nameKey="label" cx="50%" cy="50%" innerRadius={34} outerRadius={52} paddingAngle={segs.length > 1 ? 2 : 0} stroke="none">
              {segs.map((s, i) => <Cell key={i} fill={s.color} />)}
            </Pie>
            <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0', padding: '4px 8px' }} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[19px] font-bold leading-none text-slate-800 tabular-nums">{total}</span>
          <span className="mt-0.5 text-[8.5px] uppercase tracking-wide text-slate-400">{centerLabel}</span>
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        {segs.map((s) => (
          <div key={s.label} className="flex items-center justify-between gap-2 text-[11.5px]">
            <span className="flex min-w-0 items-center gap-1.5 text-slate-600">
              <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="truncate">{s.label}</span>
            </span>
            <span className="font-semibold tabular-nums text-slate-800">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- cards ---------- */

function Kpi({ label, value, tone, sub, Icon }: { label: string; value: string; tone: string; sub: string; Icon: typeof Gauge }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
        <Icon className="h-4 w-4" style={{ color: tone }} />
      </div>
      <div className="mt-1 text-[27px] font-bold leading-none" style={{ color: tone }}>{value}</div>
      <div className="mt-1.5 text-[11px] text-slate-400">{sub}</div>
    </div>
  );
}

function ModuleCard({ c }: { c: Card & { key: string; label: string; href: string; Icon: typeof Gauge; viz: Viz } }) {
  const band = scoreBand(c.score);
  const Icon = c.Icon;
  return (
    <Link href={c.href}
      className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md">
      <div className="h-[3px] w-full" style={{ backgroundColor: band.hex }} />
      <div className="flex flex-1 flex-col p-4">
        <div className="mb-2 flex items-center gap-3.5">
          <ScoreRing score={c.score} size={54} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <Icon className="h-4 w-4 text-slate-400" />
              <h3 className="truncate text-[14px] font-semibold text-slate-800">{c.label}</h3>
            </div>
            <span className="mt-1 inline-block rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide" style={{ backgroundColor: `${band.hex}14`, color: band.hex }}>{band.label}</span>
          </div>
          {c.note && (
            <span className="ml-auto self-start rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-600">{c.note}</span>
          )}
        </div>

        <div className="mt-1 flex-1">
          {c.viz === 'radar' && <div className="h-[152px] w-full">{c.subs.length ? <RadarViz subs={c.subs} tone={band.hex} /> : null}</div>}
          {c.viz === 'bars' && <div className="h-[152px] w-full">{c.subs.length ? <BarsViz subs={c.subs} /> : null}</div>}
          {c.viz === 'donut' && <div className="flex h-[152px] w-full items-center">{c.segs && c.segs.length ? <DonutViz segs={c.segs} total={c.total ?? 0} centerLabel="total" /> : null}</div>}
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-[11.5px] font-semibold" style={{ color: band.hex }}>
        <span>Open {c.label}</span>
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

function FallbackModuleCard({ c }: { c: Card & { key: string; label: string; href: string; Icon: typeof Gauge; viz: Viz } }) {
  const Icon = c.Icon;
  const tone = '#64748b';
  const hasChart = (c.segs?.length ?? 0) > 0;
  const total = c.total ?? 0;

  return (
    <Link href={c.href}
      className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md">
      <div className="h-[3px] w-full bg-slate-300" />
      <div className="flex flex-1 flex-col p-4">
        <div className="mb-2 flex items-center gap-3.5">
          <div className="flex h-[54px] w-[54px] flex-shrink-0 flex-col items-center justify-center rounded-full border-2 border-slate-200 bg-slate-50">
            <span className="text-[15px] font-bold leading-none text-slate-700 tabular-nums">{total > 0 ? total : '—'}</span>
            <span className="mt-0.5 text-[7px] uppercase tracking-wide text-slate-400">{c.hasData ? 'items' : 'no data'}</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <Icon className="h-4 w-4 text-slate-400" />
              <h3 className="truncate text-[14px] font-semibold text-slate-800">{c.label}</h3>
            </div>
            <span className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-slate-500">
              {c.hasData ? 'Count snapshot' : 'No data yet'}
            </span>
          </div>
          {c.note && (
            <span className="ml-auto self-start rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">{c.note}</span>
          )}
        </div>

        <div className="mt-1 flex flex-1 items-center">
          {hasChart ? (
            <div className="h-[152px] w-full">
              <DonutViz segs={c.segs!} total={total} centerLabel={total === 1 ? 'item' : 'items'} />
            </div>
          ) : (
            <div className="flex h-[152px] w-full flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-4 text-center">
              <Icon className="mb-2 h-6 w-6 text-slate-300" />
              <p className="text-[12px] font-medium text-slate-500">No data yet</p>
              <p className="mt-1 text-[10.5px] text-slate-400">Open the module to get started</p>
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-[11.5px] font-semibold text-slate-500 group-hover:text-slate-700">
        <span>Open {c.label}</span>
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

function PrioritiesCard({ cards }: { cards: Array<Card & { key: string; label: string; href: string; Icon: typeof Gauge }> }) {
  const weak: Array<{ module: string; href: string; label: string; score: number; Icon: typeof Gauge }> = [];
  cards.forEach((c) => {
    if (c.score == null) return;
    (c.subs || []).forEach((s) => {
      if (typeof s.score === 'number') weak.push({ module: c.label, href: c.href, label: s.label, score: s.score, Icon: c.Icon });
    });
  });
  weak.sort((a, b) => a.score - b.score);
  const top = weak.slice(0, 6);
  if (!top.length) return null;

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="h-[3px] w-full bg-rose-500" />
      <div className="flex flex-1 flex-col p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-rose-50"><Flame className="h-4 w-4 text-rose-500" /></span>
          <div>
            <h3 className="text-[14px] font-semibold text-slate-800">Where to act first</h3>
            <p className="text-[10.5px] text-slate-400">Lowest-scoring areas across all modules</p>
          </div>
        </div>
        <div className="flex-1 space-y-1.5">
          {top.map((w, i) => {
            const b = scoreBand(w.score);
            const Icon = w.Icon;
            return (
              <Link key={i} href={w.href}
                className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-slate-50">
                <Icon className="h-3.5 w-3.5 flex-shrink-0 text-slate-300" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11.5px] font-medium text-slate-700">{w.label}</div>
                  <div className="text-[9.5px] uppercase tracking-wide text-slate-400">{w.module}</div>
                </div>
                <span className="relative h-1.5 w-12 flex-shrink-0 rounded-full bg-slate-100">
                  <span className="block h-1.5 rounded-full" style={{ width: `${Math.max(6, Math.min(100, w.score))}%`, backgroundColor: b.hex }} />
                </span>
                <span className="w-8 flex-shrink-0 text-right text-[11px] font-bold tabular-nums" style={{ color: b.hex }}>{r0(w.score)}%</span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function MainModuleCards() {
  const { hasAnyPermission, isAdmin, isLoading: permsLoading } = usePermissions();

  const visibleModules = MODULES.filter((m) => {
    if (isAdmin) return true;
    if (!m.requiredPermissions?.length) return true;
    return hasAnyPermission(m.requiredPermissions);
  });

  const results = useQueries({
    queries: visibleModules.map((m) => ({
      queryKey: m.queryKey ?? ['main-dashboard', m.key],
      queryFn: async () => { try { return (await apiClient.get(m.path)).data; } catch { return null; } },
      staleTime: 60_000,
      enabled: !permsLoading,
    })),
  });

  const { data: riskOverview } = useQuery({
    queryKey: SCORECARD_QUERY_KEYS.erm,
    queryFn: async () => {
      try { return (await apiClient.get('/erm/dashboard/sections-overview')).data; }
      catch { return null; }
    },
    staleTime: 60_000,
    enabled: !permsLoading && (isAdmin || hasAnyPermission(['erm:risks:*'])),
  });

  const cards = visibleModules.map((m, i) => ({ ...m, ...m.map(results[i].data) }));
  const isScoredCard = (c: (typeof cards)[number]) =>
    c.score != null || (c.subs?.length > 0 && c.subs.some((s) => s.score != null));
  const scoredCards = cards.filter(isScoredCard);
  const fallbackCards = cards.filter((c) => !isScoredCard(c));

  const scores = scoredCards.map((c) => c.score).filter((s): s is number => s != null);
  const overall = scores.length ? r0(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const oBand = scoreBand(overall);
  const riskScore = riskOverview?.performance?.score ?? null;
  const posture = riskScore == null ? '—' : riskScore >= 70 ? 'Low' : riskScore >= 50 ? 'Moderate' : 'Elevated';
  const postureTone = riskScore == null ? '#94a3b8' : scoreBand(riskScore).hex;
  const pastSla = cards.reduce((a, c) => a + (c.pastSla ?? 0), 0);
  const withData = cards.filter((c) => c.score != null || c.hasData).length;

  if (permsLoading) {
    return (
      <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
        Loading module dashboard…
      </div>
    );
  }

  return (
    <div className="mb-6 space-y-3.5">
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <Kpi label="Overall Readiness" value={overall == null ? '—' : `${overall}%`} tone={oBand.hex} sub={`${scores.length} scored modules · target 85`} Icon={Gauge} />
        <Kpi label="Risk Posture" value={posture} tone={postureTone} sub={riskScore == null ? 'from ERM risk register' : `ERM risk score at ${r0(riskScore)}`} Icon={Scale} />
        <Kpi label="Open Items Past SLA" value={`${pastSla}`} tone={pastSla > 0 ? '#e11d48' : '#059669'} sub="overdue issues · assessments" Icon={AlertTriangle} />
        <Kpi label="Modules Visible" value={`${withData} / ${visibleModules.length}`} tone="#0369a1" sub="permission-filtered · each links to its module" Icon={Layers} />
      </div>

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
        {scoredCards.map((c) => <ModuleCard key={c.key} c={c} />)}
        {fallbackCards.map((c) => <FallbackModuleCard key={c.key} c={c} />)}
        <PrioritiesCard cards={scoredCards} />
      </div>
    </div>
  );
}
