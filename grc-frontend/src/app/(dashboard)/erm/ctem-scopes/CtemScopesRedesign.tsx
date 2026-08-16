'use client';

/**
 * CTEM Scopes & Cycles — redesign (drop-in for src/app/(dashboard)/erm/ctem-scopes/page.tsx)
 *
 * Stack: React + TypeScript + Tailwind + lucide-react (matches the app).
 * Colours use the app's Tailwind theme: `primary` (#1ed4b0 / 700 #17b898) + slate/emerald/rose/amber/sky.
 *
 * This file ships with MOCK data (SCOPES / CW below) so it renders standalone.
 * To wire it to the backend, delete the mock arrays and feed real data into the
 * same shapes via react-query, e.g.:
 *
 *   const { data } = useQuery({ queryKey: ['ctem-scopes'], queryFn: () => ctemScopesApi.list().then(r => r.data) });
 *   const scopes: Scope[] = data?.scopes ?? [];
 *   // per-scope command-center numbers come from ctemScopesApi.commandCenter(id)
 *
 * Hover guidance uses native `title` attributes — swap for your Tooltip component if you have one.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ctemScopesApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { AiControlProposalsPanel } from './_components/AiControlProposalsPanel';
import {
  Crosshair, Plus, ExternalLink, Square, Play, RefreshCw, ArrowRight, Coins,
  ShieldCheck, Server, BarChart3, Calendar, Table2, Search, Send, CreditCard,
  Lock, Users, PlayCircle, Loader2, AlertTriangle,
} from 'lucide-react';

/* ────────────────────────────── types ────────────────────────────── */

type Tier = 'tested' | 'failed' | 'verified' | 'claimed';
type Risk = 'crit' | 'high' | 'med' | 'low';
type Sev = 'critical' | 'high' | 'medium' | 'low';

interface Machine { id: number; name: string; type: string; findings: number; risk: Risk | null }
interface Framework { name: string; controls: number; tested: number }
interface Finding { id: number; rank: number; title: string; meta: string; breaks: string; owner: string | null; sla: string | null; sev: Sev }
interface ControlItem { fw: string; code: string; title: string; findings: number; tier: Tier; control_id?: number; kind?: string }

interface Scope {
  id: number; name: string; owner: string | null;
  cadence: string; membership: string;
  cycleOpen: boolean; cycleId?: number | null; cycleNo: number; cycleDay?: number | null; lastClosed?: string | null;
  assets: number; findings: number; dangerous: number; chains: number;
  controls: number; tested: number; failed: number; verified?: number; claimed: number;
  fixes: number; fixesOpen: number; fixesResolved: number;
  // per-scope FAIR has NO real source (risks aren't scope-linked) → null, rendered honestly
  ale: number | null; aleMin: number | null; p95: number | null; aleAfter: number | null;
  buckets: { ranked: number; undeterminable: number; chainless: number; severed: number };
  analysable?: { real_vulnerabilities: number; informational: number } | null;
  frameworks: Framework[]; machines: Machine[]; top: Finding[];
  tFind: number[]; tDang: number[];
  prevFind: number | null; prevDang: number | null; prevMob: number | null;
  cw: ControlItem[];
}
interface Portfolio { scopes: Scope[]; quantify?: { demo_only?: boolean; ale?: number | null; p95?: number | null; currency?: string | null } | null }

/* ───────────────────────────── mock data ─────────────────────────── */

// (mock data removed — this component is wired to /erm/ctem/scopes/portfolio)

/* ─────────────────────────── helpers ─────────────────────────── */

const money = (v: number | null | undefined, ccy?: string | null) =>
  v == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: ccy || 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(v);

const riskColor = (r: Risk | null) => (r === 'crit' ? '#be123c' : r === 'high' ? '#f97316' : r === 'med' ? '#eab308' : r === 'low' ? '#10b981' : '#cbd5e1');

const sevStyle = (sev: Sev): { label: string; className: string } => ({
  critical: { label: 'Critical', className: 'bg-rose-50 text-rose-800' },
  high: { label: 'High', className: 'bg-orange-50 text-orange-700' },
  medium: { label: 'Medium', className: 'bg-amber-50 text-amber-700' },
  low: { label: 'Low', className: 'bg-blue-50 text-blue-700' },
}[sev]);

const tierStyle = (t: Tier): { label: string; className: string } => ({
  tested: { label: 'tested ✓', className: 'bg-emerald-50 text-emerald-700' },
  failed: { label: 'tested ✗', className: 'bg-rose-50 text-rose-700' },
  verified: { label: 'fix verified', className: 'bg-sky-50 text-sky-700' },
  claimed: { label: 'only claimed', className: 'bg-slate-100 text-slate-600' },
}[t]);

/** Build a polyline + area path for a sparkline scaled to [w,h]. */
function spark(vals: number[], w: number, h: number, pad: number) {
  const max = Math.max(...vals), min = Math.min(...vals), range = max - min || 1, n = vals.length;
  const pts = vals.map((v, i) => {
    const x = pad + (i / (n - 1)) * (w - 2 * pad);
    const y = pad + (1 - (v - min) / range) * (h - 2 * pad);
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as const;
  });
  const line = pts.map((p) => p.join(',')).join(' ');
  const area = `M ${pts[0][0]},${h} ` + pts.map((p) => `L ${p[0]},${p[1]}`).join(' ') + ` L ${pts[n - 1][0]},${h} Z`;
  return { line, area };
}

/** Two series on one shared scale (findings + dangerous). */
function sparkPair(a: number[], b: number[], w: number, h: number, pad: number) {
  const all = [...a, ...b], max = Math.max(...all), min = Math.min(...all), range = max - min || 1, n = a.length;
  const map = (vals: number[]) => vals.map((v, i) => {
    const x = pad + (i / (n - 1)) * (w - 2 * pad);
    const y = pad + (1 - (v - min) / range) * (h - 2 * pad);
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as const;
  });
  const pa = map(a), pb = map(b);
  const line = (p: readonly (readonly [number, number])[]) => p.map((q) => q.join(',')).join(' ');
  const area = (p: readonly (readonly [number, number])[]) =>
    `M ${p[0][0]},${h} ` + p.map((q) => `L ${q[0]},${q[1]}`).join(' ') + ` L ${p[n - 1][0]},${h} Z`;
  return { aLine: line(pa), aArea: area(pa), bLine: line(pb) };
}

function delta(cur: number, prev: number | null | undefined, goodDown: boolean) {
  if (prev == null) return { text: '—', color: 'text-slate-400' };   // no comparable freeze yet — honest
  const d = cur - prev;
  const text = d > 0 ? `+${d}` : `${d}`;
  let color = 'text-slate-500';
  if (d !== 0) color = (goodDown ? d < 0 : d > 0) ? 'text-emerald-600' : 'text-rose-600';
  return { text, color };
}

const CIRC = 2 * Math.PI * 30;

/* ───────────────────────── small UI atoms ───────────────────────── */

const Card = ({ className = '', ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`} {...props} />
);

const SectionTitle = ({ icon, children, className = '' }: { icon: React.ReactNode; children: React.ReactNode; className?: string }) => (
  <p className={`flex items-center gap-2 text-[13px] font-semibold text-slate-900 ${className}`}>{icon}{children}</p>
);

/* ───────────────────────────── page ─────────────────────────────── */

export default function CtemScopesRedesign() {
  const qc = useQueryClient();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('risks:risk_register:edit');
  const [selId, setSelId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', cadence: 'quarterly', name_contains: '', departments: '' });

  // ONE call for the whole portfolio — every scope's command-center numbers.
  const { data, isLoading } = useQuery<Portfolio>({
    queryKey: ['ctem-portfolio'],
    queryFn: async () => (await ctemScopesApi.portfolio()).data,
  });
  const SCOPES: Scope[] = data?.scopes ?? [];
  const quantify = data?.quantify ?? null;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ctem-portfolio'] });
    qc.invalidateQueries({ queryKey: ['ctem-scopes'] });
    qc.invalidateQueries({ queryKey: ['ctem-command-center'] });
  };
  const createMutation = useMutation({
    mutationFn: () => ctemScopesApi.create({
      name: form.name, cadence: form.cadence || null,
      membership_rule: {
        name_contains: form.name_contains || null,
        departments: form.departments ? form.departments.split(',').map((x) => x.trim()).filter(Boolean) : null,
      },
    }),
    onSuccess: () => { setShowCreate(false); setForm({ name: '', cadence: 'quarterly', name_contains: '', departments: '' }); setError(null); invalidate(); },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Failed to create scope'),
  });
  const openMutation = useMutation({
    mutationFn: (scopeId: number) => ctemScopesApi.openCycle(scopeId),
    onSuccess: () => { setError(null); invalidate(); },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Failed to open cycle'),
  });
  const closeMutation = useMutation({
    mutationFn: (cycleId: number) => ctemScopesApi.closeCycle(cycleId),
    onSuccess: () => { setError(null); invalidate(); },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Failed to close cycle'),
  });

  const portfolio = useMemo(() => {
    const sum = (f: (s: Scope) => number) => SCOPES.reduce((a, s) => a + f(s), 0);
    const controls = sum((s) => s.controls), tested = sum((s) => s.tested);
    // trend across scopes: align on the LAST N points each scope has (real, may be short)
    const n = Math.max(1, ...SCOPES.map((s) => s.tFind.length));
    const series = Array.from({ length: n }, (_, i) => SCOPES.reduce((a, s) => {
      const off = s.tFind.length - n + i; return a + (off >= 0 ? s.tFind[off] : 0);
    }, 0));
    const pf = spark(series.length > 1 ? series : [series[0] ?? 0, series[0] ?? 0], 220, 30, 3);
    return {
      scopes: SCOPES.length,
      openCycles: SCOPES.filter((s) => s.cycleOpen).length,
      assets: sum((s) => s.assets),
      findings: sum((s) => s.findings),
      dangerous: sum((s) => s.dangerous),
      // FAIR is portfolio-only, and honest about [DEMO]-only inputs
      exposure: quantify && !quantify.demo_only ? money(quantify.ale, quantify.currency) : null,
      worst: quantify && !quantify.demo_only ? money(quantify.p95, quantify.currency) : null,
      coverage: controls ? Math.round((tested / controls) * 100) : 0,
      spark: pf,
    };
  }, [SCOPES, quantify]);

  const maxDang = Math.max(...SCOPES.map((s) => s.dangerous), 0) || 1;
  const s: Scope | undefined = SCOPES.find((x) => x.id === selId) ?? SCOPES[0];
  const view: 'program' | 'empty' = SCOPES.length === 0 && !isLoading ? 'empty' : 'program';

  if (isLoading) {
    return <div className="flex items-center gap-2 py-16 justify-center text-slate-500"><Loader2 className="h-5 w-5 animate-spin" /> Loading exposure program…</div>;
  }
  if (!s) {
    return (
      <div className="space-y-4">
        {error && <p className="flex items-start gap-1.5 rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}</p>}
        <EmptyState onCreate={() => setShowCreate(true)} canEdit={canEdit} />
        {showCreate && (
          <CreateScopeForm form={form} setForm={setForm} onSubmit={() => createMutation.mutate()} onCancel={() => setShowCreate(false)} pending={createMutation.isPending} />
        )}
      </div>
    );
  }

  const covTotal = Math.max(1, s.tested + s.failed + (s.verified ?? 0) + s.claimed);
  const pair = sparkPair(s.tFind, s.tDang, 240, 56, 6);
  const progressPct = s.cycleOpen ? Math.round((s.fixes / Math.max(1, s.dangerous)) * 100) : 100;
  const progressColor = progressPct >= 66 ? '#10b981' : progressPct >= 34 ? '#f59e0b' : '#e11d48';
  const dF = delta(s.findings, s.prevFind, false);
  const dD = delta(s.dangerous, s.prevDang, true);
  const dM = delta(s.fixes, s.prevMob, false);
  const fb = s.findings || 1;
  const alePos = s.ale != null && s.aleMin != null && s.p95 != null ? Math.max(6, Math.min(94, Math.round(((s.ale - s.aleMin) / Math.max(1, s.p95 - s.aleMin)) * 100))) : 50;
  const cwByFramework = s.frameworks.map((f) => `${f.name} ${f.controls}`).join(' · ');
  const findingsHref = `/vulnerabilities?ctem_scope_id=${s.id}&ctem_scope_name=${encodeURIComponent(s.name)}`;

  const stages = [
    { n: 1, label: 'Scope', value: s.assets, sub: `${s.machines.length} machines in scope`, accent: 'plain' as const },
    { n: 2, label: 'Discover', value: s.findings, sub: 'found on them', accent: 'plain' as const },
    { n: 3, label: 'Prioritise', value: s.dangerous, sub: `reachable, of ${s.findings}`, accent: 'rose' as const },
    { n: 4, label: 'Validate', value: s.controls, sub: 'cover these findings', accent: 'plain' as const },
    { n: 5, label: 'Mobilise', value: s.fixes, sub: `${s.fixesOpen} open · ${s.fixesResolved} done`, accent: 'emerald' as const },
  ];
  const convs = ['scanned', `${s.dangerous} reachable`, 'covered by', `${s.fixes} shipped`];

  return (
    <div className="space-y-4">
      {error && (
        <p className="flex items-start gap-1.5 rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}
      {showCreate && (
        <CreateScopeForm form={form} setForm={setForm} onSubmit={() => createMutation.mutate()} onCancel={() => setShowCreate(false)} pending={createMutation.isPending} />
      )}

      {view === 'program' ? (
        <div className="mx-auto w-full max-w-[1520px] space-y-4">
          {/* ── header ── */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-[19px] font-semibold tracking-tight text-slate-900">Exposure program</h1>
              <p className="mt-1 max-w-2xl text-[13px] text-slate-500">
                Every scope is one owned slice of your attack surface. Pick a scope to run its loop — discover,
                prioritise, validate, mobilise — as an explicit cycle you open and close by hand.
              </p>
            </div>
            {canEdit && (
              <button onClick={() => setShowCreate((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3.5 py-2.5 text-[13px] font-semibold text-white shadow-sm transition hover:bg-primary-700">
                <Plus className="h-4 w-4" strokeWidth={2.2} /> New scope
              </button>
            )}
          </div>

          {/* ── portfolio KPI band ── */}
          <Card className="flex items-stretch divide-x divide-slate-100 overflow-hidden">
            <KpiCell label="Scopes" value={portfolio.scopes} sub={`${portfolio.openCycles} cycles open`} title="Named slices of the attack surface you run the loop over." />
            <KpiCell label="Attack surface" value={portfolio.assets} sub="assets monitored" title="Distinct assets matching at least one scope's membership rule." />
            <div className="flex flex-[1.3] flex-col justify-between p-[14px_18px]" title="Total findings across all scopes, last 5 cycles.">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Open findings</p>
                <p className="mt-1 text-[26px] font-bold leading-none tabular-nums text-slate-900">{portfolio.findings}</p>
              </div>
              <svg viewBox="0 0 220 34" preserveAspectRatio="none" className="mt-1.5 h-[26px] w-full">
                <path d={portfolio.spark.area} fill="rgba(30,212,176,0.14)" />
                <polyline points={portfolio.spark.line} fill="none" stroke="#1ed4b0" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <KpiCell label="Dangerous now" value={portfolio.dangerous} sub="reachable attack paths" valueClass="text-rose-700" title="Findings with a confirmed, reachable attack path." />
            <KpiCell label="Annual exposure" value={portfolio.exposure ?? <span className="text-[15px] font-semibold text-slate-400">not quantified</span>} sub={portfolio.exposure ? `worst case ${portfolio.worst}` : (quantify?.demo_only ? 'only [DEMO] risks on file' : 'no real risks quantified')} title="Portfolio FAIR run. Shown only when computed from real risks." />
            <div className="flex-[1.05] p-[14px_18px]" title="Share of mapped controls tested effective, across all scopes.">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Control coverage</p>
              <p className="mt-1 text-[26px] font-bold leading-none tabular-nums text-slate-900">{portfolio.coverage}%</p>
              <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-gradient-to-r from-primary-600 to-primary-700" style={{ width: `${portfolio.coverage}%` }} />
              </div>
            </div>
          </Card>

          {/* ── rail + command centre ── */}
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[300px_1fr]">
            {/* rail (sticky) */}
            <div className="space-y-2 lg:sticky lg:top-0">
              <div className="flex items-center justify-between px-0.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Scopes</p>
                <span className="text-[11px] text-slate-400">{portfolio.scopes}</span>
              </div>
              {SCOPES.map((sc) => {
                const active = sc.id === s.id;
                const dot = sc.dangerous >= 10 ? '#be123c' : sc.dangerous >= 5 ? '#f59e0b' : '#10b981';
                return (
                  <button
                    key={sc.id}
                    onClick={() => setSelId(sc.id)}
                    className={`w-full rounded-xl border bg-white p-3 text-left transition ${
                      active ? 'border-primary-600 ring-[3px] ring-primary-600/10' : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[13.5px] font-semibold text-slate-900">{sc.name}</p>
                        <p className="mt-0.5 text-[11px] text-slate-500">{sc.assets} assets · {sc.cadence.toLowerCase()}</p>
                      </div>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                        sc.cycleOpen ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-500'
                      }`}>
                        {sc.cycleOpen ? `#${sc.cycleNo} open` : 'idle'}
                      </span>
                    </div>
                    <div className="mt-2.5 flex items-center gap-2.5 text-[11px] text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} />
                        <b className="font-semibold tabular-nums text-slate-700">{sc.dangerous}</b> dangerous
                      </span>
                      <span className="text-slate-300">·</span>
                      <span><b className="font-semibold tabular-nums text-slate-700">{sc.findings}</b> findings</span>
                    </div>
                  </button>
                );
              })}
              {canEdit && (
                <button onClick={() => setShowCreate(true)} className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 p-2.5 text-[12.5px] font-medium text-slate-500 transition hover:border-slate-400 hover:text-slate-700">
                  <Plus className="h-4 w-4" /> New scope
                </button>
              )}

              {/* dangerous by scope */}
              <Card className="p-3.5">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Dangerous by scope</p>
                <div className="space-y-2.5">
                  {SCOPES.map((sc) => {
                    const w = Math.max(6, Math.round((sc.dangerous / maxDang) * 100));
                    const c = sc.dangerous >= 10 ? '#be123c' : sc.dangerous >= 5 ? '#f59e0b' : '#10b981';
                    return (
                      <div key={sc.id}>
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span className="truncate text-[11.5px] text-slate-600">{sc.name}</span>
                          <span className="shrink-0 text-[11.5px] font-bold tabular-nums text-slate-900">{sc.dangerous}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full" style={{ width: `${w}%`, background: c }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5">
                  <span className="text-[11px] text-slate-500">Total reachable now</span>
                  <span className="text-[13px] font-bold tabular-nums text-rose-700">{portfolio.dangerous}</span>
                </div>
              </Card>

              {/* cycle cadence */}
              <Card className="p-3.5">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Cycle cadence</p>
                <div className="space-y-2.5">
                  {SCOPES.map((sc) => (
                    <div key={sc.id} className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[12px] font-medium text-slate-700">{sc.name}</p>
                        <p className="mt-px text-[10.5px] text-slate-400">{sc.cycleOpen ? `${sc.cadence} · running` : `${sc.cadence} cadence`}</p>
                      </div>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                        sc.cycleOpen ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'
                      }`}>
                        {sc.cycleOpen ? 'Open' : 'Idle'}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            {/* command centre */}
            <div className="space-y-3.5">
              {/* detail header */}
              <Card className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3.5">
                  <div className="min-w-0 flex-[1_1_320px]">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h2 className="text-lg font-semibold tracking-tight text-slate-900">{s.name}</h2>
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[11px] font-semibold ${
                        s.cycleOpen ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-500'
                      }`}>
                        {s.cycleOpen ? `Cycle #${s.cycleNo} · Open` : 'No open cycle'}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[12px] text-slate-600">
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title={s.owner ? 'Business owner' : 'No business owner set on this scope yet'}>
                        <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold ${s.owner ? 'bg-primary-50 text-primary-800' : 'bg-slate-100 text-slate-400'}`}>
                          {s.owner ? s.owner.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() : '?'}
                        </span>
                        {s.owner ?? <span className="text-slate-400">owner unassigned</span>}
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-slate-500"><Calendar className="h-3.5 w-3.5" /> {s.cadence} cadence</span>
                      <span className="inline-flex items-center gap-1.5 text-slate-500"><Table2 className="h-3.5 w-3.5" /> {s.membership}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Link href={findingsHref} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-[7px] text-[12.5px] font-medium text-slate-700 transition hover:bg-slate-50">
                      <ExternalLink className="h-3.5 w-3.5" /> View findings
                    </Link>
                    {canEdit && (s.cycleOpen ? (
                      <button onClick={() => s.cycleId && closeMutation.mutate(s.cycleId)} disabled={closeMutation.isPending || !s.cycleId}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-[7px] text-[12.5px] font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">
                        {closeMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />} Close cycle
                      </button>
                    ) : (
                      <button onClick={() => openMutation.mutate(s.id)} disabled={openMutation.isPending}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-[7px] text-[12.5px] font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50">
                        {openMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Open cycle
                      </button>
                    ))}
                  </div>
                </div>
              </Card>

              {/* cycle status banner */}
              <div className={`flex items-center gap-3 rounded-2xl border p-[13px_18px] shadow-sm ${
                s.cycleOpen ? 'border-emerald-200 bg-gradient-to-r from-emerald-50 to-white' : 'border-slate-200 bg-white'
              }`}>
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                  {s.cycleOpen && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />}
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: s.cycleOpen ? '#10b981' : '#94a3b8' }} />
                </span>
                <div className="min-w-0">
                  <p className={`text-[13.5px] font-semibold ${s.cycleOpen ? 'text-emerald-800' : 'text-slate-700'}`}>
                    {s.cycleOpen ? `Cycle #${s.cycleNo} is open — the loop is running` : 'No open cycle — the loop is paused'}
                  </p>
                  <p className="mt-0.5 text-[11.5px] text-slate-500">
                    {s.cycleOpen
                      ? `Opened this round · day ${s.cycleDay ?? 0}. Nothing opens itself — you close it by hand.`
                      : s.cycleNo > 0 ? `Last cycle (#${s.cycleNo}) closed ${s.lastClosed ?? ''}. Those numbers are frozen.` : 'No cycle has been run on this scope yet.'}
                  </p>
                </div>
                <p className="ml-auto hidden max-w-[300px] text-right text-[11px] leading-snug text-slate-400 md:block">
                  {s.cycleOpen
                    ? "Closing freezes today's counts with the membership rule as a hash-verified record."
                    : 'Open a cycle to run discover → prioritise → validate → mobilise again.'}
                </p>
              </div>

              {/* the CTEM loop */}
              <Card className="p-4">
                <div className="mb-3.5 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2">
                    <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-primary-700" />
                    <div>
                      <p className="text-[13px] font-semibold text-slate-900">The CTEM loop</p>
                      <p className="mt-0.5 text-[11px] text-slate-400">Each stage runs on the output of the one before it — found → reachable → covered → shipped.</p>
                    </div>
                  </div>
                  <span className={`rounded-full border px-2.5 py-[3px] text-[11px] ${
                    s.cycleOpen ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'
                  }`}>
                    {s.cycleOpen ? `Day ${s.cycleDay ?? 0} · opened this cycle` : s.lastClosed ? `Last closed ${s.lastClosed} — frozen` : 'No cycle yet'}
                  </span>
                </div>

                <div className="flex items-stretch overflow-x-auto">
                  {stages.map((st, i) => (
                    <div key={st.label} className="contents">
                      <Link
                        href={[ '/assets', findingsHref, '/vulnerabilities/choke-points', '/control-library/assurance', findingsHref ][i]}
                        className={`block min-w-0 flex-1 rounded-xl border p-3 transition hover:border-primary-300 ${
                          st.accent === 'rose' ? 'border-rose-200 bg-rose-50/60' : st.accent === 'emerald' ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-slate-50'
                        }`}
                        title={st.sub}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className={`inline-flex h-[19px] w-[19px] items-center justify-center rounded-full text-[10px] font-bold text-white ${
                            st.accent === 'rose' ? 'bg-rose-700' : st.accent === 'emerald' ? 'bg-emerald-600' : 'bg-slate-900'
                          }`}>{st.n}</span>
                          <span className={`text-[11px] font-semibold uppercase tracking-wide ${
                            st.accent === 'rose' ? 'text-rose-800' : st.accent === 'emerald' ? 'text-emerald-700' : 'text-slate-600'
                          }`}>{st.label}</span>
                        </div>
                        <p className={`mt-2 text-[28px] font-bold leading-none tabular-nums ${
                          st.accent === 'rose' ? 'text-rose-700' : st.accent === 'emerald' ? 'text-emerald-700' : 'text-slate-900'
                        }`}>{st.value}</p>
                        <p className={`mt-1 text-[11px] ${st.accent === 'rose' ? 'text-rose-800' : st.accent === 'emerald' ? 'text-emerald-700' : 'text-slate-500'}`}>{st.sub}</p>
                      </Link>
                      {i < stages.length - 1 && (
                        <div className="flex w-14 shrink-0 flex-col items-center justify-center gap-1">
                          <span className="text-center text-[9px] font-semibold uppercase leading-tight tracking-wide text-slate-400">{convs[i]}</span>
                          <ArrowRight className="h-4 w-4 text-slate-300" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </Card>

              {/* what to fix first + exposure */}
              <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1.7fr_1fr]">
                <Card className="p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <SectionTitle icon={<Crosshair className="h-[15px] w-[15px] text-rose-700" />}>What to fix first</SectionTitle>
                    <Link href="/vulnerabilities/choke-points" className="text-[12px] font-medium text-primary-700 hover:underline">Ranked list →</Link>
                  </div>
                  <div className="mb-1.5 flex h-2 overflow-hidden rounded-full bg-slate-100" title={`How this scope's ${s.findings} findings split by attack-path status.`}>
                    <div style={{ width: `${(s.buckets.ranked / fb) * 100}%`, background: '#be123c' }} />
                    <div style={{ width: `${(s.buckets.undeterminable / fb) * 100}%`, background: '#f59e0b' }} />
                    <div style={{ width: `${(s.buckets.chainless / fb) * 100}%`, background: '#cbd5e1' }} />
                    <div style={{ width: `${(s.buckets.severed / fb) * 100}%`, background: '#10b981' }} />
                  </div>
                  {s.analysable && (
                    <p className="mb-2 text-[10.5px] text-slate-500">
                      <b className="font-semibold text-slate-700">{s.analysable.real_vulnerabilities}</b> real vulnerabilities (CVE / weakness type the engine can reason about) ·{' '}
                      <b className="font-semibold text-slate-700">{s.analysable.informational}</b> informational (scanner notes with no CVE — can only ever be &ldquo;can&apos;t tell&rdquo;).
                    </p>
                  )}
                  <div className="mb-3.5 flex flex-wrap gap-x-4 gap-y-2.5 text-[11px] text-slate-500">
                    <Legend color="#be123c" value={s.buckets.ranked} label="dangerous" />
                    <Legend color="#f59e0b" value={s.buckets.undeterminable} label="can't tell" />
                    <Legend color="#cbd5e1" value={s.buckets.chainless} label="not calculated" />
                    <Legend color="#10b981" value={s.buckets.severed} label="blocked" />
                  </div>
                  <div className="space-y-0.5">
                    {s.top.length === 0 && (
                      <p className="rounded-lg bg-slate-50 p-3 text-[11.5px] text-slate-500">
                        No finding in this scope has a reachable attack path right now.
                        {s.buckets.chainless > 0 && ' Attack paths have not been calculated for ' + s.buckets.chainless + ' yet — run “Calculate attack paths” on the choke-points page.'}
                      </p>
                    )}
                    {s.top.map((f) => {
                      const sv = sevStyle((['critical','high','medium','low'].includes(f.sev) ? f.sev : 'low') as Sev);
                      const overdue = /overdue/.test(f.sla || '');
                      return (
                        <Link key={f.id} href={`/vulnerabilities/${f.id}`} className="flex items-center gap-3 rounded-lg border border-transparent p-2 transition hover:border-slate-200 hover:bg-slate-50">
                          <span className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md bg-slate-100 text-[11px] font-bold tabular-nums text-slate-500">{f.rank}</span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[12.5px] font-medium text-slate-900">{f.title}</p>
                            <p className="mt-px truncate text-[11px] text-slate-400">{f.meta} · breaks {f.breaks}</p>
                          </div>
                          <span className={`shrink-0 text-[10.5px] font-medium ${overdue ? 'text-rose-600' : 'text-slate-500'}`}>{f.sla ?? 'no SLA'}</span>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${sv.className}`}>{sv.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </Card>

                <Card className="flex flex-col p-4">
                  <SectionTitle icon={<Coins className="h-[15px] w-[15px] text-emerald-600" />} className="mb-3">Financial exposure</SectionTitle>
                  {s.ale == null ? (
                    <div className="rounded-xl bg-amber-50 p-3">
                      <p className="text-[13px] font-semibold text-slate-800">Not quantified for this scope</p>
                      <p className="mt-1 text-[11.5px] leading-snug text-slate-600">
                        Risk quantification (FAIR) is portfolio-level and risks aren&apos;t linked to a scope yet, so a per-scope figure would be invented.
                        {quantify?.demo_only && ' The only portfolio run on file used [DEMO] sample risks — add real risks to quantify.'}
                      </p>
                    </div>
                  ) : (<>
                  <p className="text-[32px] font-bold leading-none tabular-nums text-slate-900">{money(s.ale)}</p>
                  <p className="mt-1.5 text-[11.5px] text-slate-500">annualised loss (ALE)</p>
                  <div className="mt-4">
                    <div className="relative h-2 rounded-full bg-gradient-to-r from-emerald-200 via-amber-200 to-rose-200">
                      <span className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-slate-900 shadow" style={{ left: `${alePos}%` }} title="Most likely annual loss on the range from best to worst case." />
                    </div>
                    <div className="mt-1.5 flex justify-between">
                      <span className="text-[10.5px] text-slate-500">min {money(s.aleMin)}</span>
                      <span className="text-[10.5px] font-medium text-rose-700">P95 {money(s.p95)}</span>
                    </div>
                  </div>
                  </>)}
                  <div className="mt-auto border-t border-slate-100 pt-3.5">
                    {s.aleAfter != null && <p className="text-[11px] text-slate-500">If the {s.dangerous} dangerous findings are fixed, modelled loss drops to <b className="text-emerald-700">{money(s.aleAfter)}</b>.</p>}
                    <Link href="/erm/risks" className="mt-2 inline-block text-[12px] font-medium text-primary-700 hover:underline">Open the risk dashboard →</Link>
                  </div>
                </Card>
              </div>

              {/* coverage + cycle progress + machines */}
              <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3">
                {/* control coverage */}
                <Card className="p-4">
                  <SectionTitle icon={<ShieldCheck className="h-[15px] w-[15px] text-primary-700" />} className="mb-3.5">Control coverage</SectionTitle>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[30px] font-bold leading-none tabular-nums text-slate-900">{Math.round((s.tested / covTotal) * 100)}%</span>
                    <span className="text-[11.5px] text-slate-500">tested effective</span>
                  </div>
                  <div className="my-3 flex h-[9px] overflow-hidden rounded-full bg-slate-100">
                    <div style={{ width: `${(s.tested / covTotal) * 100}%`, background: '#10b981' }} />
                    <div style={{ width: `${(s.failed / covTotal) * 100}%`, background: '#f43f5e' }} />
                    <div style={{ width: `${(s.claimed / covTotal) * 100}%`, background: '#cbd5e1' }} />
                  </div>
                  <div className="flex flex-wrap gap-x-3.5 gap-y-2 text-[11px] text-slate-500">
                    <Legend color="#10b981" value={s.tested} label="tested" />
                    <Legend color="#f43f5e" value={s.failed} label="failed" />
                    <Legend color="#cbd5e1" value={s.claimed} label="claimed" />
                  </div>
                  <div className="mt-3.5 space-y-2 border-t border-slate-100 pt-3">
                    {s.frameworks.map((fw) => (
                      <div key={fw.name}>
                        <div className="mb-1 flex items-center justify-between text-[11px]">
                          <span className="font-medium text-slate-600">{fw.name}</span>
                          <span className="tabular-nums text-slate-400">{fw.tested}/{fw.controls}</span>
                        </div>
                        <div className="h-[5px] overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-primary-600" style={{ width: `${fw.controls ? Math.round((fw.tested / fw.controls) * 100) : 0}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>

                {/* cycle progress + trend */}
                <Card className="p-4">
                  <SectionTitle icon={<BarChart3 className="h-[15px] w-[15px] text-primary-700" />} className="mb-3">Cycle progress</SectionTitle>
                  <div className="flex items-center gap-3.5">
                    <div className="relative h-[74px] w-[74px] shrink-0">
                      <svg width="74" height="74" viewBox="0 0 74 74">
                        <circle cx="37" cy="37" r="30" fill="none" stroke="#eef1f4" strokeWidth="8" />
                        <circle cx="37" cy="37" r="30" fill="none" stroke={progressColor} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(progressPct / 100) * CIRC} ${CIRC}`} transform="rotate(-90 37 37)" />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-[17px] font-bold tabular-nums text-slate-900">{progressPct}%</span>
                      </div>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[12px] leading-snug text-slate-600">
                        {s.cycleOpen ? `${s.fixes} of ${s.dangerous} dangerous findings mobilised into fixes` : `Cycle closed — ${s.fixes} of ${s.dangerous} were mobilised`}
                      </p>
                      <p className="mt-1.5 text-[11px] text-slate-400">{s.cycleOpen ? `Cycle #${s.cycleNo} · day ${s.cycleDay ?? 0}` : s.lastClosed ? `Frozen ${s.lastClosed}` : 'No cycle yet'}</p>
                    </div>
                  </div>
                  <div className="mt-3.5 border-t border-slate-100 pt-3">
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Findings over cycles</p>
                    <svg viewBox="0 0 240 56" preserveAspectRatio="none" className="h-11 w-full">
                      <path d={pair.aArea} fill="rgba(30,212,176,0.12)" />
                      <polyline points={pair.aLine} fill="none" stroke="#1ed4b0" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                      <polyline points={pair.bLine} fill="none" stroke="#e11d48" strokeWidth={2} strokeDasharray="3 3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <div className="mt-1.5 flex gap-3.5">
                      <LineKey color="#1ed4b0" label="findings" />
                      <LineKey color="#e11d48" label="dangerous" />
                    </div>
                  </div>
                  <div className="mt-3.5 border-t border-slate-100 pt-3">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">vs. last cycle</p>
                    <div className="flex gap-2">
                      <DeltaCell text={dF.text} color={dF.color} label="findings" />
                      <DeltaCell text={dD.text} color={dD.color} label="dangerous" />
                      <DeltaCell text={dM.text} color={dM.color} label="mobilised" />
                    </div>
                  </div>
                </Card>

                {/* machines */}
                <Card className="p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <SectionTitle icon={<Server className="h-[15px] w-[15px] text-primary-700" />}>Machines in scope</SectionTitle>
                    <span className="text-[11px] tabular-nums text-slate-400">{s.machines.length}</span>
                  </div>
                  <div className="space-y-0.5">
                    {s.machines.map((m) => (
                      <Link key={m.id} href={`/assets/${m.id}`} className="flex items-center gap-2.5 rounded-lg border border-transparent p-2 transition hover:border-slate-200 hover:bg-slate-50">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: riskColor(m.risk) }} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12.5px] font-medium text-slate-900">{m.name}</p>
                          <p className="mt-px text-[10.5px] text-slate-400">{m.type}</p>
                        </div>
                        <span className="shrink-0 text-right">
                          <span className="block text-[13px] font-bold leading-none tabular-nums text-slate-900">{m.findings}</span>
                          <span className="text-[9.5px] text-slate-400">findings</span>
                        </span>
                      </Link>
                    ))}
                  </div>
                  <Link href="/assets" className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-medium text-primary-700 hover:underline">
                    Asset inventory <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Card>
              </div>

              {/* where the controls come from */}
              <Card className="p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <SectionTitle icon={<ShieldCheck className="h-[15px] w-[15px] text-primary-700" />}>Where these controls come from</SectionTitle>
                  <span className="text-[11px] text-slate-400">{cwByFramework}</span>
                </div>
                <p className="mb-3 mt-1.5 max-w-3xl text-[11.5px] text-slate-500">
                  Matched from each finding&apos;s weakness type (CWE) to your uploaded frameworks by exact control code — not AI,
                  not keyword guessing. Opening a control shows its evidence and test history.
                </p>
                <div className="overflow-hidden rounded-xl border border-slate-100">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400">
                        <th className="px-3 py-2 text-left font-semibold">Framework</th>
                        <th className="px-3 py-2 text-left font-semibold">Control</th>
                        <th className="px-3 py-2 text-right font-semibold">Findings covered</th>
                        <th className="px-3 py-2 text-left font-semibold">Assurance status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.cw.map((c) => {
                        const ts = tierStyle(c.tier);
                        return (
                          <tr key={`${c.fw}-${c.code}`} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50">
                            <td className="whitespace-nowrap px-3 py-2 text-slate-500">{c.fw}</td>
                            <td className="px-3 py-2 text-slate-700"><span className="font-mono font-medium text-slate-900">{c.code}</span>&nbsp;&nbsp;{c.title}</td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">{c.findings}</td>
                            <td className="px-3 py-2"><span className={`rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold ${ts.className}`}>{ts.label}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2.5 text-[10.5px] text-slate-400">
                  &ldquo;Only claimed&rdquo; becomes &ldquo;tested&rdquo; when real evidence lands — a re-scan that no longer sees the finding, or a retest recorded against the control.
                </p>
              </Card>

              {/* P5: AI-suggested SPECIFIC controls — human-approved */}
              <AiControlProposalsPanel scopeId={s.id} />
            </div>
          </div>
        </div>
      ) : (
        <EmptyState onCreate={() => setShowCreate(true)} canEdit={canEdit} />
      )}
    </div>
  );
}

/* ─────────────────────── sub-components ─────────────────────── */

function KpiCell({ label, value, sub, valueClass = 'text-slate-900', title }: { label: string; value: React.ReactNode; sub: string; valueClass?: string; title?: string }) {
  return (
    <div className="flex-1 p-[14px_18px]" title={title}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-[26px] font-bold leading-none tabular-nums ${valueClass}`}>{value}</p>
      <p className="mt-1.5 text-[11px] text-slate-500">{sub}</p>
    </div>
  );
}

const Legend = ({ color, value, label }: { color: string; value: number; label: string }) => (
  <span className="inline-flex items-center gap-1.5">
    <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
    <b className="tabular-nums text-slate-900">{value}</b> {label}
  </span>
);

const LineKey = ({ color, label }: { color: string; label: string }) => (
  <span className="inline-flex items-center gap-1.5 text-[10.5px] text-slate-500">
    <span className="h-0.5 w-3" style={{ background: color }} /> {label}
  </span>
);

const DeltaCell = ({ text, color, label }: { text: string; color: string; label: string }) => (
  <div className="flex-1 rounded-lg border border-slate-100 bg-slate-50 py-1.5 text-center">
    <p className={`text-[14px] font-bold tabular-nums ${color}`}>{text}</p>
    <p className="mt-0.5 text-[9.5px] text-slate-400">{label}</p>
  </div>
);

function CreateScopeForm({ form, setForm, onSubmit, onCancel, pending }: {
  form: { name: string; cadence: string; name_contains: string; departments: string };
  setForm: (f: any) => void; onSubmit: () => void; onCancel: () => void; pending: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
      <p className="text-[13px] font-semibold text-slate-900">New scope</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Name</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Customer payment platform" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Cadence (advisory only)</label>
          <input value={form.cadence} onChange={(e) => setForm({ ...form, cadence: e.target.value })} placeholder="monthly / quarterly" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Membership: asset name contains</label>
          <input value={form.name_contains} onChange={(e) => setForm({ ...form, name_contains: e.target.value })} placeholder="e.g. payment, web01" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Membership: departments (comma-separated)</label>
          <input value={form.departments} onChange={(e) => setForm({ ...form, departments: e.target.value })} placeholder="e.g. Payments, Platform" className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={onSubmit} disabled={pending || !form.name} className="rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
          {pending ? 'Creating…' : 'Create scope'}
        </button>
        <button onClick={onCancel} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
      </div>
    </div>
  );
}

function EmptyState({ onCreate, canEdit }: { onCreate: () => void; canEdit: boolean }) {
  const steps = [
    { n: 1, label: 'Scope', icon: <Server className="h-[18px] w-[18px] text-slate-600" />, sub: 'Bound the assets you care about', bg: 'bg-slate-100' },
    { n: 2, label: 'Discover', icon: <Search className="h-[18px] w-[18px] text-slate-600" />, sub: 'Pull in scanner findings', bg: 'bg-slate-100' },
    { n: 3, label: 'Prioritise', icon: <Crosshair className="h-[18px] w-[18px] text-rose-700" />, sub: 'Rank by reachable attack path', bg: 'bg-rose-50' },
    { n: 4, label: 'Validate', icon: <ShieldCheck className="h-[18px] w-[18px] text-slate-600" />, sub: 'Check the controls that cover them', bg: 'bg-slate-100' },
    { n: 5, label: 'Mobilise', icon: <Send className="h-[18px] w-[18px] text-emerald-700" />, sub: 'Push fixes to a ticket', bg: 'bg-emerald-50' },
  ];
  const templates = [
    { icon: <CreditCard className="h-4 w-4 text-primary-700" />, title: 'Internet-facing tier', sub: 'Public web, edge and WAF assets' },
    { icon: <Lock className="h-4 w-4 text-primary-700" />, title: 'Payment platform', sub: 'PCI-scoped assets and services' },
    { icon: <Users className="h-4 w-4 text-primary-700" />, title: 'Identity plane', sub: 'IdP, MFA and directory sync' },
  ];
  return (
    <div className="mx-auto w-full max-w-[1520px] space-y-4">
      <Card className="relative overflow-hidden p-10 text-center">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_100%_at_50%_0%,rgba(30,212,176,0.07),transparent_60%)]" />
        <div className="relative">
          <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-[18px] bg-primary-50">
            <Crosshair className="h-[30px] w-[30px] text-primary-700" strokeWidth={1.75} />
          </div>
          <h2 className="text-[22px] font-semibold tracking-tight text-slate-900">Run your first exposure cycle</h2>
          <p className="mx-auto mt-2.5 max-w-lg text-[13.5px] leading-relaxed text-slate-500">
            A scope is a named, owned slice of your attack surface. Create one, then run the CTEM loop over it as an
            explicit cycle — you open and close each round by hand.
          </p>

          <div className="mx-auto mt-7 flex max-w-3xl items-stretch justify-center">
            {steps.map((st, i) => (
              <div key={st.label} className="contents">
                <div className="flex-1">
                  <div className={`mb-2.5 inline-flex h-[38px] w-[38px] items-center justify-center rounded-xl ${st.bg}`}>{st.icon}</div>
                  <p className="text-[12px] font-semibold text-slate-900">{st.n} · {st.label}</p>
                  <p className="mx-1.5 mt-1 text-[10.5px] leading-snug text-slate-400">{st.sub}</p>
                </div>
                {i < steps.length - 1 && <div className="flex items-start pt-[19px] text-slate-300"><ArrowRight className="h-4 w-4" /></div>}
              </div>
            ))}
          </div>

          <div className="mt-7 flex items-center justify-center gap-3">
            <button className="inline-flex items-center gap-1.5 rounded-[10px] bg-primary-600 px-5 py-2.5 text-[13.5px] font-semibold text-white shadow-sm transition hover:bg-primary-700">
              <Plus className="h-4 w-4" strokeWidth={2.2} /> Create your first scope
            </button>
            <a href="#" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-600 hover:text-slate-800">
              <PlayCircle className="h-[15px] w-[15px]" /> Watch 2-min overview
            </a>
          </div>
        </div>
      </Card>

      <div>
        <p className="mb-2.5 pl-0.5 text-[12px] font-semibold uppercase tracking-wide text-slate-400">Or start from a template</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {templates.map((t) => (
            <button key={t.title} className="rounded-xl border border-slate-200 bg-white p-3.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="mb-2.5 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary-50">{t.icon}</div>
              <p className="text-[13px] font-semibold text-slate-900">{t.title}</p>
              <p className="mt-1 text-[11.5px] leading-snug text-slate-500">{t.sub}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
