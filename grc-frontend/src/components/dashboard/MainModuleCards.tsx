'use client';

/**
 * Main dashboard — module aggregation. One card per major module, each with a
 * chart matched to its data (radar for multi-dimension score modules, target
 * columns for others, donuts for count modules) so the grid reads as a varied
 * board view rather than one repeated shape. A "Where to act first" card closes
 * the grid. Empty modules collapse to a compact chip strip. All scores come from
 * each module's own formula endpoint — nothing is computed here beyond blending.
 */

import { useQueries } from '@tanstack/react-query';
import Link from 'next/link';
import apiClient from '@/lib/api';
import { scoreBand, ScoreRing } from '@/components/dashboard/score-kit';
import {
  RadarChart, PolarGrid, PolarAngleAxis, Radar,
  BarChart, Bar, XAxis, YAxis, Cell, LabelList, ReferenceLine,
  PieChart, Pie, ResponsiveContainer, Tooltip,
} from 'recharts';
import {
  Landmark, ShieldCheck, Scale, ClipboardCheck, Server, Bug, ListTodo,
  FileCheck, BadgeCheck, ArrowRight, Gauge, AlertTriangle, Layers, Flame,
} from 'lucide-react';

type Sub = { label: string; score?: number | null };
type Seg = { label: string; value: number; color: string };
type Viz = 'radar' | 'bars' | 'donut';
type Card = { score: number | null; subs: Sub[]; segs?: Seg[]; total?: number; note?: string | null; pastSla?: number };

const r0 = (v: number) => Math.round(v);
const hex = (s?: number | null) => scoreBand(s).hex;
const short = (s: string, n = 11) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// A module's real section scores, worst-first so weak areas surface.
const sectionSubs = (d: any): Sub[] => {
  const comps: any[] = d?.performance?.components ?? Object.values(d?.sections ?? {});
  return (comps || [])
    .filter((c) => c && c.label)
    .map((c) => ({ label: c.label as string, score: (c.score ?? null) as number | null }))
    .sort((a, b) => (a.score ?? 999) - (b.score ?? 999))
    .slice(0, 6);
};

const MODULES: Array<{ key: string; label: string; href: string; Icon: typeof Gauge; path: string; viz: Viz; map: (d: any) => Card }> = [
  {
    key: 'governance', label: 'Governance', href: '/governance', Icon: Landmark, viz: 'radar',
    path: '/governance/dashboard/documents-overview',
    map: (d) => ({ score: d?.performance?.score ?? null, subs: sectionSubs(d) }),
  },
  {
    key: 'compliance', label: 'Compliance', href: '/compliance', Icon: ShieldCheck, viz: 'bars',
    path: '/compliance/policies/dashboard/sections-overview',
    map: (d) => ({ score: d?.performance?.score ?? null, subs: sectionSubs(d) }),
  },
  {
    key: 'risk', label: 'Risk', href: '/erm', Icon: Scale, viz: 'radar',
    path: '/erm/dashboard/sections-overview',
    map: (d) => ({ score: d?.performance?.score ?? null, subs: sectionSubs(d) }),
  },
  {
    key: 'assessments', label: 'Assessments', href: '/assessments', Icon: ClipboardCheck, viz: 'bars',
    path: '/compliance/assessments/overview',
    map: (d) => ({
      score: d?.performance?.score ?? null,
      subs: (d?.categories ?? []).map((c: any) => ({ label: c.category, score: c.score })).sort((a: Sub, b: Sub) => (a.score ?? 999) - (b.score ?? 999)),
      pastSla: d?.attention?.overdue_gaps ?? 0,
    }),
  },
  {
    key: 'assets', label: 'Assets', href: '/assets', Icon: Server, viz: 'radar',
    path: '/assets/inventory-overview',
    map: (d) => ({ score: d?.performance?.score ?? null, subs: sectionSubs(d) }),
  },
  {
    key: 'vulnerabilities', label: 'Vulnerabilities', href: '/vulnerabilities', Icon: Bug, viz: 'donut',
    path: '/vuln-management/dashboard',
    map: (d) => {
      const total = d?.total_vulnerabilities ?? d?.total ?? 0;
      const overdue = d?.overdue_count ?? 0;
      const sev = d?.by_severity ?? {};
      const segs: Seg[] = [
        { label: 'Critical', value: sev.critical ?? 0, color: '#e11d48' },
        { label: 'High', value: sev.high ?? 0, color: '#f97316' },
        { label: 'Medium', value: sev.medium ?? 0, color: '#eab308' },
        { label: 'Low', value: sev.low ?? 0, color: '#64748b' },
      ].filter((s) => s.value > 0);
      return {
        score: total ? r0(100 * (1 - overdue / total)) : null,   // empty → n/a, not a fake 100
        subs: [], segs, total,
        note: overdue > 0 ? `${overdue} past SLA` : null,
        pastSla: overdue,
      };
    },
  },
  {
    key: 'issues', label: 'Issues', href: '/issues', Icon: ListTodo, viz: 'donut',
    path: '/issue-management/dashboard/aggregate',
    map: (d) => {
      const k = d?.kpis ?? {};
      const open = k.open ?? 0, breached = k.sla_breached ?? 0, inprog = k.in_progress ?? 0, resolved = k.resolved ?? k.closed ?? 0;
      // any issues at all? sum count-like kpis (ignore averages/rates). all zero → empty → n/a.
      const isCount = (key: string) => !/avg|time|day|rate|pct|percent|mttr|hour/i.test(key);
      const totalCounts = Object.entries(k).filter(([key, v]) => typeof v === 'number' && isCount(key)).reduce((s, [, v]) => s + (v as number), 0);
      const hasData = totalCounts > 0;
      const segs: Seg[] = [
        { label: 'Open', value: open, color: '#d97706' },
        { label: 'In progress', value: inprog, color: '#0ea5e9' },
        { label: 'Resolved', value: resolved, color: '#059669' },
      ].filter((s) => s.value > 0);
      return {
        score: hasData ? (open ? r0(100 * (1 - breached / open)) : 100) : null,
        subs: [], segs, total: open + inprog + resolved,
        note: breached > 0 ? `${breached} SLA breached` : null,
        pastSla: breached,
      };
    },
  },
  {
    key: 'evidence', label: 'Evidence', href: '/evidence', Icon: FileCheck, viz: 'donut',
    path: '/evidence',
    map: (d) => {
      const arr = Array.isArray(d) ? d : (d?.items ?? []);
      const total = arr.length;
      const st = (e: any) => String(e?.status || '').toLowerCase();
      const approved = arr.filter((e: any) => st(e) === 'approved').length;
      const pending = arr.filter((e: any) => ['pending_review', 'draft', 'pending'].includes(st(e))).length;
      const other = Math.max(0, total - approved - pending);
      const now = Date.now();
      const expiring = arr.filter((e: any) => e?.expiry_date && new Date(e.expiry_date).getTime() - now < 30 * 864e5 && new Date(e.expiry_date).getTime() > now).length;
      const segs: Seg[] = [
        { label: 'Approved', value: approved, color: '#059669' },
        { label: 'Pending', value: pending, color: '#d97706' },
        { label: 'Other', value: other, color: '#94a3b8' },
      ].filter((s) => s.value > 0);
      return {
        score: total ? r0(100 * approved / total) : null,
        subs: [], segs, total,
        note: expiring > 0 ? `${expiring} expiring 30d` : null,
      };
    },
  },
  {
    key: 'attestation', label: 'Attestation', href: '/governance', Icon: BadgeCheck, viz: 'donut',
    path: '/governance/attestation-campaigns/dashboard',
    map: (d) => {
      const completed = d?.completed_requests ?? 0, pending = d?.pending_requests ?? 0, overdue = d?.overdue_requests ?? 0;
      const total = d?.total_requests ?? (completed + pending + overdue);
      const rate = d?.completion_rate;
      const segs: Seg[] = [
        { label: 'Completed', value: completed, color: '#059669' },
        { label: 'Pending', value: pending, color: '#d97706' },
        { label: 'Overdue', value: overdue, color: '#e11d48' },
      ].filter((s) => s.value > 0);
      return {
        score: total ? (rate != null ? r0(rate) : r0(100 * completed / total)) : null,
        subs: [], segs, total,
        note: overdue > 0 ? `${overdue} overdue` : null,
      };
    },
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

// Horizontal bars so long category names ("Control Library", "Digital
// Operations") stay fully readable on the left instead of truncating.
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
          {c.viz === 'donut' && <div className="flex h-[152px] w-full items-center">{c.segs && c.segs.length ? <DonutViz segs={c.segs} total={c.total ?? 0} centerLabel={c.key === 'attestation' || c.key === 'issues' ? 'total' : c.key === 'evidence' ? 'files' : 'vulns'} /> : null}</div>}
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-[11.5px] font-semibold" style={{ color: band.hex }}>
        <span>Open {c.label}</span>
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

// "Where to act first" — the weakest scored areas across every module, so the
// board sees the priority list, not just per-module scores. Closes the grid.
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
  const results = useQueries({
    queries: MODULES.map((m) => ({
      queryKey: ['main-dashboard', m.key],
      queryFn: async () => { try { return (await apiClient.get(m.path)).data; } catch { return null; } },
      staleTime: 60_000,
    })),
  });

  const cards = MODULES.map((m, i) => ({ ...m, ...m.map(results[i].data) }));
  const scores = cards.map((c) => c.score).filter((s): s is number => s != null);
  const overall = scores.length ? r0(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const oBand = scoreBand(overall);
  const risk = cards.find((c) => c.key === 'risk');
  const posture = risk?.score == null ? '—' : risk.score >= 70 ? 'Low' : risk.score >= 50 ? 'Moderate' : 'Elevated';
  const postureTone = risk?.score == null ? '#94a3b8' : scoreBand(risk.score).hex;
  const pastSla = cards.reduce((a, c) => a + (c.pastSla ?? 0), 0);
  const tracked = scores.length;
  // Only modules with data get a full card; empty ones collapse to a chip strip.
  const active = cards.filter((c) => c.score != null);
  const empty = cards.filter((c) => c.score == null);

  return (
    <div className="mb-6 space-y-3.5">
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <Kpi label="Overall Readiness" value={overall == null ? '—' : `${overall}%`} tone={oBand.hex} sub={`${tracked} modules scored · target 85`} Icon={Gauge} />
        <Kpi label="Risk Posture" value={posture} tone={postureTone} sub={risk?.score == null ? 'from Risk module' : `Risk module at ${r0(risk.score)}`} Icon={Scale} />
        <Kpi label="Open Items Past SLA" value={`${pastSla}`} tone={pastSla > 0 ? '#e11d48' : '#059669'} sub="overdue vulns · issues · assessments" Icon={AlertTriangle} />
        <Kpi label="Modules Tracked" value={`${tracked} / ${MODULES.length}`} tone="#0369a1" sub="each links to its overview" Icon={Layers} />
      </div>

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
        {active.map((c) => <ModuleCard key={c.key} c={c} />)}
        <PrioritiesCard cards={active} />
      </div>

      {empty.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-3.5 py-2.5">
          <span className="mr-1 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
            <Layers className="h-3.5 w-3.5" /> Not tracked yet
          </span>
          {empty.map((c) => {
            const Icon = c.Icon;
            return (
              <Link key={c.key} href={c.href}
                className="group inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11.5px] font-medium text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700">
                <Icon className="h-3.5 w-3.5 text-slate-400" />
                {c.label}
                <span className="text-[10px] text-slate-300 group-hover:text-slate-400">Set up</span>
                <ArrowRight className="h-3 w-3 text-slate-300 transition-transform group-hover:translate-x-0.5" />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
