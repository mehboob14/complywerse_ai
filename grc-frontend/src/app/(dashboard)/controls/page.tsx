'use client';

/**
 * Control CATALOG — the compliance workbench, organized by the Library's 20
 * canonical domains (baseline normalization mapping — no AI at request time).
 * Views: By Domain (card hub → domain detail with per-framework sections),
 * By Framework, All Controls (flat power view), My Work. Every row opens the
 * same workbench drawer: assign, effectiveness & testing, AI test-procedure
 * checklists (+ per-point evidence), evidence review, risks, workflow.
 */
import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { RightSlidePanel, MultiSelectDropdown } from '@/components/ui';
import ControlSurfaceTabs from '@/components/dashboard/ControlSurfaceTabs';
import {
  Plus, Search, ShieldCheck, Sparkles, Loader2, Check, X, ChevronRight, ChevronLeft,
  Upload, Star, Trash2, AlertTriangle, ClipboardCheck, Boxes, Layers,
  KeyRound, Database, Landmark, Share2, ServerCog, Siren, RefreshCw, Activity,
  Network, GitBranch, Code2, Bug, Building2, GraduationCap, Lock, Scale,
  Users, CircleHelp, FileClock, FlaskConical, BookOpenCheck, Pencil, SlidersHorizontal,
} from 'lucide-react';

const WB = '/control-library/workbench';

// read ?mode reactively (survives client-side redirects, e.g. /erm/internal-controls → ?mode=internal)
export const dynamic = 'force-dynamic';

const SOURCE_BADGE: Record<string, { label: string; cls: string }> = {
  framework: { label: 'Framework', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  internal: { label: 'Internal Control', cls: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  normalized: { label: 'Normalized', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
};
const EFF: Record<string, { label: string; dot: string; text: string }> = {
  effective: { label: 'Effective', dot: 'bg-emerald-500', text: 'text-emerald-700' },
  partially_effective: { label: 'Partially effective', dot: 'bg-amber-500', text: 'text-amber-700' },
  ineffective: { label: 'Ineffective', dot: 'bg-rose-500', text: 'text-rose-700' },
  not_tested: { label: 'Not tested', dot: 'bg-slate-300', text: 'text-slate-500' },
};
const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600', pending_approval: 'bg-amber-100 text-amber-700',
  active: 'bg-emerald-100 text-emerald-700', inactive: 'bg-slate-100 text-slate-500',
  deprecated: 'bg-rose-100 text-rose-700',
};
const IMPL_BADGE: Record<string, string> = {
  not_started: 'bg-slate-100 text-slate-500', in_progress: 'bg-blue-100 text-blue-700',
  implemented: 'bg-indigo-100 text-indigo-700', verified: 'bg-emerald-100 text-emerald-700',
  not_applicable: 'bg-slate-100 text-slate-400',
};
const eff = (v?: string | null) => EFF[v || 'not_tested'] || EFF.not_tested;
const initials = (n?: string) => (n || 'U').split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase();

type Row = {
  source_type: string; source_id: number; work_item_id: number | null;
  code?: string; name?: string; domain?: string; canonical_domain?: string;
  framework_name?: string; member_count?: number;
  status?: string | null; implementation_status?: string;
  design_effectiveness?: string | null; operating_effectiveness?: string | null;
  assigned_user_ids?: number[]; assignees?: { id: number; display_name: string }[]; is_key_control?: boolean;
  next_test_date?: string | null; overdue?: boolean;
};
type BySource = { framework: number; internal: number; normalized: number };
type Trend = { since: string; tested: number; effective: number; assigned: number; overdue: number };
type DomainStat = {
  domain: string; controls: number; frameworks: number; assigned: number; tested: number;
  effective: number; partially_effective: number; ineffective: number; evidence_pending: number;
  overdue?: number; by_source?: BySource;
};
type WorkStats = { controls: number; assigned: number; tested: number; effective: number; partially_effective: number; ineffective: number; evidence_pending: number; overdue?: number };
type Overview = {
  domains: DomainStat[];
  totals: WorkStats & { by_source?: BySource };
  internal?: WorkStats;
  frameworks: { id: number; name: string; controls: number }[];
  trend?: Trend | null;
  scope: { framework_ids: number[]; scoped: boolean };
};
type Group = { type: string; framework_id: number | null; name: string; controls: number; tested: number; effective: number; partially_effective: number; ineffective: number };

// per-domain icon + tint (keyword-matched; classes literal for Tailwind JIT)
const TINT: Record<string, { bg: string; text: string }> = {
  primary: { bg: 'bg-primary-50', text: 'text-primary-700' },
  blue: { bg: 'bg-blue-50', text: 'text-blue-600' },
  violet: { bg: 'bg-violet-50', text: 'text-violet-600' },
  cyan: { bg: 'bg-cyan-50', text: 'text-cyan-600' },
  amber: { bg: 'bg-amber-50', text: 'text-amber-600' },
  rose: { bg: 'bg-rose-50', text: 'text-rose-600' },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600' },
  indigo: { bg: 'bg-indigo-50', text: 'text-indigo-600' },
  sky: { bg: 'bg-sky-50', text: 'text-sky-600' },
  orange: { bg: 'bg-orange-50', text: 'text-orange-600' },
  slate: { bg: 'bg-slate-100', text: 'text-slate-400' },
};
const DOMAIN_META: [RegExp, any, string][] = [
  [/access/i, KeyRound, 'blue'],
  [/data protection|privacy/i, Database, 'violet'],
  [/governance|leadership|policy/i, Landmark, 'primary'],
  [/third|supply/i, Share2, 'amber'],
  [/operations|service/i, ServerCog, 'cyan'],
  [/risk/i, AlertTriangle, 'rose'],
  [/incident/i, Siren, 'orange'],
  [/continuity|resilience/i, RefreshCw, 'emerald'],
  [/logging|monitoring|detection/i, Activity, 'indigo'],
  [/network|communications/i, Network, 'sky'],
  [/configuration|change/i, GitBranch, 'cyan'],
  [/application|software/i, Code2, 'blue'],
  [/vulnerability|threat/i, Bug, 'rose'],
  [/physical|environmental/i, Building2, 'amber'],
  [/asset/i, Boxes, 'primary'],
  [/awareness|training/i, GraduationCap, 'emerald'],
  [/cryptography/i, Lock, 'violet'],
  [/audit|assurance/i, BookOpenCheck, 'indigo'],
  [/compliance|legal/i, Scale, 'primary'],
  [/human resources/i, Users, 'orange'],
];
function domainMeta(name: string) {
  for (const [rx, Icon, tint] of DOMAIN_META) if (rx.test(name)) return { Icon, t: TINT[tint] };
  return { Icon: CircleHelp, t: TINT.slate };
}

function EffDots({ d, o }: { d?: string | null; o?: string | null }) {
  return (
    <span className="inline-flex items-center gap-2 text-[11px]">
      <span className="inline-flex items-center gap-1" title={`Design: ${eff(d).label}`}><span className={`h-2 w-2 rounded-full ${eff(d).dot}`} />D</span>
      <span className="inline-flex items-center gap-1" title={`Operating: ${eff(o).label}`}><span className={`h-2 w-2 rounded-full ${eff(o).dot}`} />O</span>
    </span>
  );
}

/** Effectiveness distribution bar — effective / partial / ineffective over total. */
function RagBar({ e, p, i, total, className }: { e: number; p: number; i: number; total: number; className?: string }) {
  const w = (n: number) => `${total ? (n / total) * 100 : 0}%`;
  return (
    <div className={`flex h-1.5 overflow-hidden rounded-full bg-slate-200 ${className || ''}`}
      title={`Effective ${e} · Partially ${p} · Ineffective ${i} · Not tested ${Math.max(0, total - e - p - i)}`}>
      <span className="bg-emerald-500" style={{ width: w(e) }} />
      <span className="bg-amber-500" style={{ width: w(p) }} />
      <span className="bg-rose-500" style={{ width: w(i) }} />
    </div>
  );
}

function TrendChip({ delta, goodIsUp = true }: { delta?: number; goodIsUp?: boolean }) {
  if (delta == null || delta === 0) return null;
  const up = delta > 0;
  const good = goodIsUp ? up : !up;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded px-1 text-[9.5px] font-bold tabular-nums ${good ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
      {up ? '▲' : '▼'}{Math.abs(delta)}
    </span>
  );
}

function KpiStrip({ s, trend }: { s: WorkStats & { by_source?: BySource }; trend?: Trend | null }) {
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
  const src = s.by_source;
  const srcHint = src
    ? [src.framework ? `${src.framework.toLocaleString()} framework` : '', src.internal ? `${src.internal} internal` : '', src.normalized ? `${src.normalized} normalized` : '']
      .filter(Boolean).join(' · ') || null
    : null;
  const overdue = s.overdue ?? 0;
  const cards = [
    { lab: 'Controls', val: s.controls.toLocaleString(), hint: srcHint, icon: Boxes, iw: 'bg-primary-50 text-primary-700', delta: undefined as number | undefined, goodUp: true },
    { lab: 'Assigned', val: String(s.assigned), hint: s.controls ? `${pct(s.assigned, s.controls)}%` : null, icon: Users, iw: s.assigned ? 'bg-cyan-50 text-cyan-600' : 'bg-slate-100 text-slate-400', delta: trend?.assigned, goodUp: true },
    { lab: 'Tested', val: `${pct(s.tested, s.controls)}%`, hint: `${s.tested} of ${s.controls.toLocaleString()}`, icon: FlaskConical, iw: s.tested ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-slate-400', delta: trend?.tested, goodUp: true },
    { lab: 'Effective', val: s.tested ? `${pct(s.effective, s.tested)}%` : '—', hint: s.tested ? 'of tested' : 'no tests yet', icon: ShieldCheck, iw: s.tested ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400', delta: trend?.effective, goodUp: true },
    { lab: 'Overdue', val: String(overdue), hint: overdue ? 'tests past due' : 'none due', icon: Siren, iw: overdue ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-400', delta: trend?.overdue, goodUp: false },
    { lab: 'Evidence pending', val: String(s.evidence_pending), hint: 'to review', icon: FileClock, iw: s.evidence_pending ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-400', delta: undefined, goodUp: true },
  ];
  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
      {cards.map(c => {
        const Icon = c.icon;
        return (
          <div key={c.lab} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
            <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${c.iw}`}><Icon className="h-4 w-4" /></span>
            <div className="min-w-0">
              <div className="flex items-center gap-1 truncate text-[10px] font-semibold uppercase tracking-wider text-slate-400">{c.lab}<TrendChip delta={c.delta} goodIsUp={c.goodUp} /></div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-[17px] font-bold tabular-nums leading-tight text-slate-900">{c.val}</span>
                {c.hint && <span className="truncate text-[10.5px] text-slate-400">{c.hint}</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function ControlCatalog() {
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  // top-level source switch: framework controls vs internal / risk controls.
  // Start 'framework' (matches SSR → no hydration mismatch), then reconcile on
  // mount from both useSearchParams (client redirects) AND window.location
  // (fresh deep-links, which useSearchParams can miss on first paint).
  const [mode, setMode] = useState<'framework' | 'internal'>('framework');
  useEffect(() => {
    const m = searchParams?.get('mode')
      || (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('mode') : null);
    if (m === 'internal' || m === 'framework') setMode(m);
  }, [searchParams]);
  const [view, setView] = useState<'hub' | 'byfw' | 'flat' | 'mine'>('hub');
  const [domainSel, setDomainSel] = useState<DomainStat | null>(null);
  const [internalOpen, setInternalOpen] = useState(false);
  const [flatPreset, setFlatPreset] = useState<{ effectiveness?: string; due?: string } | null>(null);
  const onAttention = (key: 'overdue' | 'ineffective' | 'partial' | 'evidence') => {
    const map: Record<string, { effectiveness?: string; due?: string }> = {
      overdue: { due: 'overdue' }, ineffective: { effectiveness: 'ineffective' },
      partial: { effectiveness: 'partially_effective' }, evidence: {},
    };
    setFlatPreset(map[key]); setDomainSel(null); setInternalOpen(false); setView('flat');
  };
  const [open, setOpen] = useState<Row | null>(null);
  const [creating, setCreating] = useState(false);
  const [promoting, setPromoting] = useState(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('promote') === '1');

  const { data: scope } = useQuery({
    queryKey: ['wb-scope'],
    queryFn: async () => (await apiClient.get(`${WB}/scope`)).data as
      { framework_ids: number[]; available: { id: number; name: string }[]; can_edit: boolean },
  });
  const { data: ov, isLoading: ovLoading } = useQuery({
    queryKey: ['wb-overview'],
    queryFn: async () => (await apiClient.get(`${WB}/overview`)).data as Overview,
  });
  const { data: mine } = useQuery({
    queryKey: ['wb-my-work'],
    queryFn: async () => (await apiClient.get(`${WB}/my-work`)).data as { total: number; items: Row[] },
  });

  const setScope = useMutation({
    mutationFn: async (ids: number[]) => apiClient.put(`${WB}/scope`, { framework_ids: ids }),
    onSuccess: () => { ['wb-scope', 'wb-overview', 'wb-list', 'wb-domains', 'wb-groups'].forEach(k => qc.invalidateQueries({ queryKey: [k] })); },
  });
  const invalidateAll = () => ['wb-overview', 'wb-list', 'wb-my-work', 'wb-groups'].forEach(k => qc.invalidateQueries({ queryKey: [k] }));

  const frameworks = scope?.available || [];
  const inInternal = view === 'hub' && internalOpen;
  const inDetail = view === 'hub' && domainSel && !internalOpen;
  const changeMode = (m: 'framework' | 'internal') => {
    setMode(m); setDomainSel(null); setInternalOpen(false);
    if (typeof window !== 'undefined') {
      const u = new URL(window.location.href);
      u.searchParams.set('mode', m);
      window.history.replaceState(window.history.state, '', u.toString());
    }
  };

  // Drilling into a domain/internal detail pushes a history entry, so the browser
  // Back button returns to the hub instead of leaving the page.
  const openDomain = (d: DomainStat) => { setDomainSel(d); if (typeof window !== 'undefined') window.history.pushState({ ctaDetail: true }, ''); };
  const openInternal = () => { setInternalOpen(true); if (typeof window !== 'undefined') window.history.pushState({ ctaDetail: true }, ''); };
  const backToHub = () => { if (typeof window !== 'undefined' && window.history.state?.ctaDetail) window.history.back(); else { setDomainSel(null); setInternalOpen(false); } };
  useEffect(() => {
    const onPop = () => { setDomainSel(null); setInternalOpen(false); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  return (
    <div className="space-y-4 p-1">
      <ControlSurfaceTabs active="catalog" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900"><Boxes className="h-5 w-5 text-primary-600" /> Control Catalog</h1>
          <p className="text-[13px] text-slate-500">Your working controls, organized by the 20 unified security domains — assign, test, evidence &amp; certify.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/controls/configure-frameworks"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
            title="Choose which frameworks are in your Control Catalog">
            <SlidersHorizontal className="h-4 w-4 text-slate-400" /> Configure frameworks
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-500">{(scope?.framework_ids?.length) ? scope.framework_ids.length : 'All'}</span>
          </Link>
        </div>
      </div>

      {/* top-level source switch — framework controls vs internal / risk controls */}
      {ov && <SourceToggle mode={mode} onChange={changeMode}
        frameworkCount={ov.totals.controls} internalCount={ov.internal?.controls ?? 0} />}

      {mode === 'internal' ? (
        <InternalMode s={ov?.internal} onOpenRow={setOpen} onNew={() => setCreating(true)} />
      ) : (
      <>
      {(scope?.framework_ids?.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
          <ShieldCheck className="h-4 w-4 flex-shrink-0 text-amber-600" />
          <span>This catalog is <b>scoped to {scope!.framework_ids.length} framework{scope!.framework_ids.length > 1 ? 's' : ''}</b> (an admin base setting) — you&apos;re not seeing every framework&apos;s controls.</span>
          {scope?.can_edit ? (
            <button onClick={() => setScope.mutate([])} disabled={setScope.isPending}
              className="ml-auto inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2 py-1 text-[11.5px] font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50">
              {setScope.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />} Clear scope · show all
            </button>
          ) : <span className="ml-auto text-[11.5px] text-amber-700">Set by an admin</span>}
        </div>
      )}

      {/* view toggle */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        {([['hub', 'By Domain'], ['byfw', 'By Framework'], ['flat', 'All Controls'], ['mine', 'My Work']] as const).map(([k, label]) => (
          <button key={k} onClick={() => { setView(k); setDomainSel(null); setInternalOpen(false); }} className={`relative px-4 py-2 text-[13px] font-medium ${view === k ? 'text-primary-700' : 'text-slate-500 hover:text-slate-700'}`}>
            {label}{k === 'mine' && (mine?.total ? ` (${mine.total})` : '')}
            {view === k && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded bg-primary-600" />}
          </button>
        ))}
      </div>

      {view === 'hub' && !inDetail && !inInternal && <DomainHub ov={ov} loading={ovLoading} onOpen={openDomain} onOpenInternal={openInternal} onNew={() => setCreating(true)} onAttention={onAttention} />}
      {inDetail && <DomainDetail d={domainSel!} onBack={backToHub} onOpenRow={setOpen} />}
      {inInternal && ov?.internal && <InternalDetail s={ov.internal} onBack={backToHub} onOpenRow={setOpen} onNew={() => setCreating(true)} />}
      {view === 'byfw' && <ByFramework ov={ov} onOpenRow={setOpen} />}
      {view === 'flat' && <FlatList frameworks={frameworks} onOpenRow={setOpen} preset={flatPreset} />}
      {view === 'mine' && <MyWork items={mine?.items || []} onOpenRow={setOpen} />}
      </>
      )}

      {open && <WorkbenchDrawer row={open} onClose={() => { setOpen(null); invalidateAll(); }} />}
      {creating && <CreateControl onClose={() => setCreating(false)} onCreated={() => { setCreating(false); invalidateAll(); }} />}
      {promoting && <PromotePicker onClose={() => setPromoting(false)} onDone={() => { setPromoting(false); invalidateAll(); }} />}
    </div>
  );
}

// ── executive posture band (hub hero) ───────────────────────────────────────
function PostureHero({ ov, onAttention }: { ov: Overview; onAttention: (f: 'overdue' | 'ineffective' | 'partial' | 'evidence') => void }) {
  const t = ov.totals;
  const total = t.controls || 1;
  const eff = t.effective, part = t.partially_effective, inef = t.ineffective;
  const tested = t.tested;
  const notTested = Math.max(0, total - eff - part - inef);
  const testedPct = Math.round((tested / total) * 100);
  const effPct = tested ? Math.round((eff / tested) * 100) : 0;
  const grade = testedPct === 0 ? { l: 'Not started', c: 'text-slate-500', bg: 'bg-slate-100' }
    : effPct >= 80 ? { l: 'Strong', c: 'text-emerald-700', bg: 'bg-emerald-100' }
      : effPct >= 60 ? { l: 'Fair', c: 'text-amber-700', bg: 'bg-amber-100' }
        : { l: 'Needs work', c: 'text-rose-700', bg: 'bg-rose-100' };
  // conic donut over the whole estate
  const segs = [['#10b981', eff], ['#f59e0b', part], ['#f43f5e', inef], ['#e2e8f0', notTested]] as const;
  let acc = 0;
  const stops = segs.map(([c, v]) => { const from = (acc / total) * 360; acc += v; const to = (acc / total) * 360; return `${c} ${from}deg ${to}deg`; }).join(', ');
  const attention = [
    { key: 'overdue' as const, label: 'Tests overdue', n: t.overdue ?? 0, dot: 'bg-rose-500', txt: 'text-rose-600' },
    { key: 'ineffective' as const, label: 'Ineffective controls', n: inef, dot: 'bg-rose-500', txt: 'text-rose-600' },
    { key: 'partial' as const, label: 'Partially effective', n: part, dot: 'bg-amber-500', txt: 'text-amber-600' },
    { key: 'evidence' as const, label: 'Evidence to review', n: t.evidence_pending, dot: 'bg-amber-500', txt: 'text-amber-600' },
  ];
  const attentionTotal = attention.reduce((a, x) => a + x.n, 0);
  const legend = [['Effective', eff, 'bg-emerald-500'], ['Partial', part, 'bg-amber-500'], ['Ineffective', inef, 'bg-rose-500'], ['Not tested', notTested, 'bg-slate-300']] as const;

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.5fr_1fr]">
      {/* posture */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-5">
          <div className="relative h-[104px] w-[104px] flex-shrink-0">
            <div className="h-full w-full rounded-full" style={{ background: `conic-gradient(${stops})` }} />
            <div className="absolute inset-[14px] flex flex-col items-center justify-center rounded-full bg-white">
              <span className="text-[24px] font-bold leading-none tabular-nums text-slate-900">{testedPct}%</span>
              <span className="text-[9px] uppercase tracking-wide text-slate-400">tested</span>
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-bold text-slate-900">Control assurance posture</h2>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${grade.bg} ${grade.c}`}>{grade.l}</span>
              {ov.trend && <TrendChip delta={ov.trend.tested} goodIsUp />}
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-slate-500">
              {tested === 0
                ? <>None of your <b className="text-slate-700">{total.toLocaleString()}</b> controls have been tested yet — start recording tests to build assurance.</>
                : <><b className="text-slate-700">{tested.toLocaleString()}</b> of {total.toLocaleString()} controls tested · <b className={grade.c}>{effPct}%</b> of those effective{(t.overdue ?? 0) > 0 && <> · <b className="text-rose-600">{t.overdue} overdue</b></>}.</>}
            </p>
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
              {legend.map(([l, v, c]) => (
                <span key={l} className="inline-flex items-center gap-1.5 text-[11px] text-slate-500"><span className={`h-2 w-2 rounded-full ${c}`} /><b className="tabular-nums text-slate-700">{v.toLocaleString()}</b> {l}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* needs attention */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="mb-1.5 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <span className="text-[13px] font-semibold text-slate-800">Needs attention</span>
          <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold ${attentionTotal ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-400'}`}>{attentionTotal}</span>
        </div>
        <div className="divide-y divide-slate-50">
          {attention.map(a => (
            <button key={a.key} onClick={() => a.n > 0 && onAttention(a.key)} disabled={a.n === 0}
              className="flex w-full items-center justify-between py-2 text-left text-[12px] text-slate-600 enabled:hover:text-slate-900 disabled:cursor-default">
              <span className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${a.n > 0 ? a.dot : 'bg-slate-200'}`} />{a.label}</span>
              <span className={`text-[14px] font-bold tabular-nums ${a.n > 0 ? a.txt : 'text-slate-300'}`}>{a.n}</span>
            </button>
          ))}
        </div>
        {attentionTotal === 0 && <p className="mt-1 text-center text-[11px] text-emerald-600">Nothing needs attention right now.</p>}
      </div>
    </div>
  );
}

// ── internal / risk controls — a first-class section (not a footnote bar) ─────
function InternalSection({ s, onOpen, onNew }: { s: WorkStats; onOpen: () => void; onNew: () => void }) {
  const has = s.controls > 0;
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
  const tiles = [
    { lab: 'Controls', val: s.controls, icon: Layers },
    { lab: 'Assigned', val: has ? s.assigned : '—', icon: Users },
    { lab: 'Tested', val: has ? `${pct(s.tested, s.controls)}%` : '—', icon: FlaskConical },
    { lab: 'Evidence', val: s.evidence_pending || '—', icon: FileClock },
  ];
  return (
    <div className="overflow-hidden rounded-2xl border border-cyan-200 bg-gradient-to-br from-cyan-50/80 via-white to-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-cyan-100/70 px-4 py-3.5">
        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-cyan-500 text-white shadow-sm"><Layers className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[14.5px] font-bold text-slate-900">Internal Controls</h3>
          <p className="text-[11.5px] text-slate-500">Your own controls, authored from the risk register — your first line of defense, distinct from framework requirements.</p>
        </div>
        <div className="flex items-center gap-2">
          {has && <button onClick={onOpen} className="inline-flex items-center gap-1 rounded-lg border border-cyan-200 bg-white px-3 py-2 text-[12.5px] font-semibold text-cyan-700 hover:bg-cyan-50">View all <ChevronRight className="h-3.5 w-3.5" /></button>}
          <button onClick={onNew} className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-2 text-[12.5px] font-semibold text-white shadow-sm hover:bg-cyan-700"><Plus className="h-4 w-4" /> New internal control</button>
        </div>
      </div>
      {has ? (
        <div className="grid grid-cols-2 gap-px bg-cyan-100/60 sm:grid-cols-4">
          {tiles.map(t => {
            const Icon = t.icon;
            return (
              <button key={t.lab} onClick={onOpen} className="flex items-center gap-2.5 bg-white/90 px-4 py-3 text-left hover:bg-cyan-50/60">
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-cyan-50 text-cyan-600"><Icon className="h-4 w-4" /></span>
                <span><span className="block text-[9.5px] font-semibold uppercase tracking-wider text-slate-400">{t.lab}</span><span className="text-[17px] font-bold tabular-nums text-slate-900">{t.val}</span></span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="px-4 py-4 text-[12px] text-slate-500">No internal controls yet — <button onClick={onNew} className="font-semibold text-cyan-700 hover:underline">author your first</button> from the risk register.</div>
      )}
    </div>
  );
}

// ── VIEW: domain hub (cards) ─────────────────────────────────────────────────
function DomainHub({ ov, loading, onOpen, onOpenInternal, onNew, onAttention }: { ov?: Overview; loading: boolean; onOpen: (d: DomainStat) => void; onOpenInternal: () => void; onNew: () => void; onAttention: (f: 'overdue' | 'ineffective' | 'partial' | 'evidence') => void }) {
  if (loading || !ov) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-[62px] animate-pulse rounded-xl bg-slate-100" />)}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-[150px] animate-pulse rounded-2xl bg-slate-100" />)}
        </div>
      </div>
    );
  }
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
  const [hubQ, setHubQ] = useState('');
  const shownDomains = hubQ ? ov.domains.filter(d => d.domain.toLowerCase().includes(hubQ.toLowerCase())) : ov.domains;
  return (
    <div className="space-y-4">
      <PostureHero ov={ov} onAttention={onAttention} />

      {/* Domains section header (internal controls now live under the top-level
          Internal Control toggle, not as a card here). */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-2">
          <h2 className="text-[13.5px] font-bold text-slate-800">Controls by domain</h2>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-semibold tabular-nums text-slate-500">{ov.domains.length} domains · {ov.totals.controls.toLocaleString()} controls</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="hidden flex-wrap items-center gap-3.5 text-[10.5px] text-slate-400 md:flex">
            {(['effective', 'partially_effective', 'ineffective', 'not_tested'] as const).map(k => (
              <span key={k} className="inline-flex items-center gap-1"><span className={`h-1.5 w-1.5 rounded-full ${EFF[k].dot}`} />{EFF[k].label}</span>
            ))}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={hubQ} onChange={e => setHubQ(e.target.value)} placeholder="Filter domains…" className="h-9 w-48 rounded-lg border border-slate-300 pl-8 pr-3 text-[13px] focus:border-primary-500 focus:outline-none" />
          </div>
        </div>
      </div>
      {shownDomains.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 py-12 text-center text-[13px] text-slate-400">No domains match “{hubQ}”.</div>
      ) : (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {shownDomains.map(d => {
          const { Icon, t } = domainMeta(d.domain);
          const misc = d.domain === 'Unclassified';
          return (
            <button key={d.domain} onClick={() => onOpen(d)}
              className={`group relative flex flex-col gap-3 rounded-2xl border bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-lg hover:shadow-slate-200/70 ${misc ? 'border-dashed border-slate-300' : 'border-slate-200'}`}>
              <div className="flex items-start gap-2.5">
                <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${t.bg} ${t.text}`}><Icon className="h-4 w-4" /></span>
                <h3 className="min-h-[34px] flex-1 pt-0.5 text-[13px] font-semibold leading-snug text-slate-800 group-hover:text-primary-700">{d.domain}</h3>
                <ChevronRight className="mt-1 h-3.5 w-3.5 flex-shrink-0 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-[25px] font-bold tabular-nums leading-none text-slate-900">{d.controls}</span>
                <span className="text-[11px] text-slate-400">{d.by_source && !d.by_source.framework && d.by_source.internal ? 'internal / risk controls' : 'controls'}</span>
                {d.frameworks > 0 && <span className="ml-auto rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-slate-500 ring-1 ring-slate-200">{d.frameworks} frameworks</span>}
              </div>
              {d.by_source && (d.by_source.internal > 0 || d.by_source.normalized > 0) && d.by_source.framework > 0 && (
                <div className="flex flex-wrap gap-1">
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[9.5px] font-semibold tabular-nums text-blue-600">{d.by_source.framework} framework</span>
                  {d.by_source.internal > 0 && <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-[9.5px] font-semibold tabular-nums text-cyan-700">{d.by_source.internal} internal / risk</span>}
                  {d.by_source.normalized > 0 && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[9.5px] font-semibold tabular-nums text-violet-600">{d.by_source.normalized} normalized</span>}
                </div>
              )}
              <RagBar e={d.effective} p={d.partially_effective} i={d.ineffective} total={d.controls} />
              <div className="flex justify-between gap-2 border-t border-slate-100 pt-2.5 text-[10px] uppercase tracking-wide text-slate-400">
                <span>Assigned<b className="mt-0.5 block text-[13px] font-semibold normal-case tracking-normal text-slate-700">{d.assigned || '—'}</b></span>
                <span>Tested<b className="mt-0.5 block text-[13px] font-semibold normal-case tracking-normal text-slate-700">{d.tested ? `${pct(d.tested, d.controls)}%` : '—'}</b></span>
                <span>Evidence<b className={`mt-0.5 block text-[13px] font-semibold normal-case tracking-normal ${d.evidence_pending ? 'text-amber-600' : 'text-slate-700'}`}>{d.evidence_pending || '—'}</b></span>
              </div>
              {(d.overdue ?? 0) > 0 && <div className="flex items-center gap-1 text-[10.5px] font-semibold text-rose-600"><Siren className="h-3 w-3" />{d.overdue} test{(d.overdue ?? 0) > 1 ? 's' : ''} overdue</div>}
            </button>
          );
        })}
      </div>
      )}
    </div>
  );
}

// ── top-level source switch (framework ⇄ internal) ───────────────────────────
function SourceToggle({ mode, onChange, frameworkCount, internalCount }: {
  mode: 'framework' | 'internal'; onChange: (m: 'framework' | 'internal') => void;
  frameworkCount: number; internalCount: number;
}) {
  const opts = [
    { k: 'framework' as const, label: 'Framework controls', icon: Boxes, count: frameworkCount },
    { k: 'internal' as const, label: 'Internal Control', icon: Layers, count: internalCount },
  ];
  return (
    <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1">
      {opts.map(o => {
        const on = mode === o.k; const Icon = o.icon;
        const onCls = o.k === 'internal' ? 'bg-white text-cyan-700 shadow-sm' : 'bg-white text-primary-700 shadow-sm';
        const badgeCls = on ? (o.k === 'internal' ? 'bg-cyan-100 text-cyan-700' : 'bg-primary-100 text-primary-700') : 'bg-slate-200 text-slate-500';
        return (
          <button key={o.k} onClick={() => onChange(o.k)}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold transition-colors ${on ? onCls : 'text-slate-500 hover:text-slate-700'}`}>
            <Icon className="h-4 w-4" />{o.label}
            <span className={`rounded-full px-1.5 text-[10.5px] tabular-nums ${badgeCls}`}>{o.count.toLocaleString()}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── internal mode (top-level view of internal / risk controls) ───────────────
function InternalMode({ s, onOpenRow, onNew }: { s?: WorkStats; onOpenRow: (r: Row) => void; onNew: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['wb-list', 'internal-all'],
    queryFn: async () => (await apiClient.get(`${WB}/controls?source=internal&limit=500`)).data as { total: number; items: Row[] },
  });
  const rows = data?.items || [];
  return (
    <div className="space-y-4">
      {/* No title bar — the top toggle already signals we're in Internal mode.
          Just the create action + a one-line note. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-slate-500">Your own controls, authored from the risk register — distinct from framework requirements.</p>
        <button onClick={onNew} className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-2 text-[13px] font-semibold text-white hover:bg-cyan-700"><Plus className="h-4 w-4" /> New internal control</button>
      </div>
      {s && <KpiStrip s={s} />}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {isLoading ? <div className="p-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-300" /></div> :
          rows.length === 0 ? <div className="p-10 text-center text-[13px] text-slate-400">No internal controls yet. Click <b>New internal control</b> to author one from your risk register.</div> :
          <ControlTable rows={rows} onOpenRow={onOpenRow} />}
      </div>
    </div>
  );
}

// ── VIEW: internal / risk controls (outside the domain taxonomy) ─────────────
function InternalDetail({ s, onBack, onOpenRow, onNew }: { s: WorkStats; onBack: () => void; onOpenRow: (r: Row) => void; onNew: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['wb-list', 'internal-all'],
    queryFn: async () => (await apiClient.get(`${WB}/controls?source=internal&limit=500`)).data as { total: number; items: Row[] },
  });
  const rows = data?.items || [];
  return (
    <div className="space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-slate-500 hover:text-primary-700">
        <ChevronLeft className="h-4 w-4" /> All domains
      </button>
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-100 text-cyan-700"><Layers className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold leading-tight text-slate-900">Internal Controls</h2>
          <p className="text-[11.5px] text-slate-400">Authored in-house, linked to your risk register — independent of the framework domains</p>
        </div>
        <button onClick={onNew} className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-2 text-[13px] font-semibold text-white hover:bg-cyan-700"><Plus className="h-4 w-4" /> New internal control</button>
      </div>
      <KpiStrip s={s} />
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {isLoading ? <div className="p-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-300" /></div> :
          rows.length === 0 ? <div className="p-10 text-center text-[13px] text-slate-400">No internal controls yet. Click <b>New internal control</b> to author one from your risk register.</div> :
          <ControlTable rows={rows} onOpenRow={onOpenRow} />}
      </div>
    </div>
  );
}

// ── VIEW: domain detail (framework sections) ─────────────────────────────────
function DomainDetail({ d, onBack, onOpenRow }: { d: DomainStat; onBack: () => void; onOpenRow: (r: Row) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['wb-groups', d.domain],
    queryFn: async () => (await apiClient.get(`${WB}/overview/${encodeURIComponent(d.domain)}/groups`)).data as
      { domain: string; groups: Group[]; total_controls: number },
  });
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const gkey = (g: Group) => `${g.type}-${g.framework_id ?? ''}`;
  const toggle = (g: Group) => setOpenKeys(ks => ks.includes(gkey(g)) ? ks.filter(x => x !== gkey(g)) : [...ks, gkey(g)]);
  const { Icon, t } = domainMeta(d.domain);
  return (
    <div className="space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-slate-500 hover:text-primary-700">
        <ChevronLeft className="h-4 w-4" /> All domains
      </button>
      <div className="flex flex-wrap items-center gap-3">
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${t.bg} ${t.text}`}><Icon className="h-5 w-5" /></span>
        <div>
          <h2 className="text-lg font-bold leading-tight text-slate-900">{d.domain}</h2>
          <p className="text-[11.5px] text-slate-400">
            {d.by_source
              ? [d.by_source.framework ? `${d.by_source.framework} framework controls (${d.frameworks} framework${d.frameworks === 1 ? '' : 's'})` : '', d.by_source.internal ? `${d.by_source.internal} internal / risk` : '', d.by_source.normalized ? `${d.by_source.normalized} normalized` : '']
                .filter(Boolean).join(' · ')
              : `${d.controls} controls across ${d.frameworks} framework${d.frameworks === 1 ? '' : 's'}`}
            {' '}— click any control to open its workbench
          </p>
        </div>
      </div>
      <KpiStrip s={{ ...d }} />
      {isLoading ? (
        <div className="space-y-2.5">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[52px] animate-pulse rounded-xl bg-slate-100" />)}</div>
      ) : (
        <div className="space-y-2.5">
          {(data?.groups || []).map(g => {
            const isOpen = openKeys.includes(gkey(g));
            const avatarCls = g.type === 'normalized' ? 'bg-violet-50 text-violet-600' : g.type === 'internal' ? 'bg-cyan-50 text-cyan-600' : 'bg-slate-100 text-slate-500';
            return (
              <div key={gkey(g)} className={`overflow-hidden rounded-xl border bg-white transition-colors ${isOpen ? 'border-primary-200 shadow-sm' : 'border-slate-200'}`}>
                <button onClick={() => toggle(g)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50/70">
                  <ChevronRight className={`h-3.5 w-3.5 flex-shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                  <span className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-[9.5px] font-bold ${avatarCls}`}>
                    {g.type === 'normalized' ? <Layers className="h-3.5 w-3.5" /> : initials(g.name)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-700">{g.name}</span>
                  {g.tested > 0
                    ? <RagBar e={g.effective} p={g.partially_effective} i={g.ineffective} total={g.controls} className="w-24 flex-shrink-0" />
                    : <span className="flex-shrink-0 text-[10px] italic text-slate-300">not tested</span>}
                  <span className="flex-shrink-0 rounded-full bg-slate-50 px-2 py-0.5 text-[10.5px] font-semibold tabular-nums text-slate-500 ring-1 ring-slate-200">{g.controls}</span>
                </button>
                {isOpen && <GroupRows domain={d.domain} group={g} onOpenRow={onOpenRow} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GroupRows({ domain, group, onOpenRow }: { domain: string; group: Group; onOpenRow: (r: Row) => void }) {
  const params = new URLSearchParams({ canonical_domain: domain, limit: '500' });
  if (group.type === 'framework' && group.framework_id) params.set('framework_id', String(group.framework_id));
  else params.set('source', group.type);
  const { data, isLoading } = useQuery({
    queryKey: ['wb-list', 'group', domain, group.type, group.framework_id],
    queryFn: async () => (await apiClient.get(`${WB}/controls?${params}`)).data as { total: number; items: Row[] },
  });
  return (
    <div className="border-t border-slate-100">
      {isLoading ? <div className="p-4 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-slate-300" /></div> : (
        <ControlTable rows={data?.items || []} onOpenRow={onOpenRow} compact />
      )}
    </div>
  );
}

// ── VIEW: by framework ───────────────────────────────────────────────────────
function ByFramework({ ov, onOpenRow }: { ov?: Overview; onOpenRow: (r: Row) => void }) {
  const [openIds, setOpenIds] = useState<number[]>([]);
  if (!ov) return <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>;
  return (
    <div className="space-y-2.5">
      <p className="text-[12px] text-slate-400">Same controls, sliced by framework — for teams that work one framework at a time.</p>
      {ov.frameworks.map(f => {
        const isOpen = openIds.includes(f.id);
        return (
          <div key={f.id} className={`overflow-hidden rounded-xl border bg-white transition-colors ${isOpen ? 'border-primary-200 shadow-sm' : 'border-slate-200'}`}>
            <button onClick={() => setOpenIds(s => isOpen ? s.filter(x => x !== f.id) : [...s, f.id])}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50/70">
              <ChevronRight className={`h-3.5 w-3.5 flex-shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
              <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[9.5px] font-bold text-slate-500">{initials(f.name)}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-700">{f.name}</span>
              <span className="flex-shrink-0 rounded-full bg-slate-50 px-2 py-0.5 text-[10.5px] font-semibold tabular-nums text-slate-500 ring-1 ring-slate-200">{f.controls}</span>
            </button>
            {isOpen && <FrameworkRows fwId={f.id} onOpenRow={onOpenRow} />}
          </div>
        );
      })}
    </div>
  );
}

function FrameworkRows({ fwId, onOpenRow }: { fwId: number; onOpenRow: (r: Row) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['wb-list', 'byfw', fwId],
    queryFn: async () => (await apiClient.get(`${WB}/controls?framework_id=${fwId}&limit=600`)).data as { total: number; items: Row[] },
  });
  return (
    <div className="border-t border-slate-100">
      {isLoading ? <div className="p-4 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-slate-300" /></div> : (
        <ControlTable rows={data?.items || []} onOpenRow={onOpenRow} compact showDomain />
      )}
    </div>
  );
}

// ── VIEW: flat list (power view — search everything) ─────────────────────────
function FlatList({ frameworks, onOpenRow, preset }: { frameworks: { id: number; name: string }[]; onOpenRow: (r: Row) => void; preset?: { effectiveness?: string; due?: string } | null }) {
  const [q, setQ] = useState('');
  const [source, setSource] = useState('all');
  const [framework, setFramework] = useState('');
  const [domain, setDomain] = useState('');
  const [effFilter, setEffFilter] = useState(preset?.effectiveness || '');
  const [due, setDue] = useState(preset?.due || '');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(0);
  const LIMIT = 50;

  const { data: domainsData } = useQuery({
    queryKey: ['wb-domains'],
    queryFn: async () => (await apiClient.get(`${WB}/domains`)).data as { domains: string[] },
  });

  const p = new URLSearchParams();
  if (source !== 'all') p.set('source', source);
  if (q) p.set('q', q);
  if (framework) p.set('framework_id', framework);
  if (domain) p.set('canonical_domain', domain);
  if (statusFilter) p.set('status', statusFilter);
  if (effFilter) p.set('effectiveness', effFilter);
  if (due) p.set('due', due);
  p.set('skip', String(page * LIMIT)); p.set('limit', String(LIMIT));

  const { data: list, isLoading } = useQuery({
    queryKey: ['wb-list', 'flat', source, q, framework, domain, statusFilter, effFilter, due, page],
    queryFn: async () => (await apiClient.get(`${WB}/controls?${p}`)).data as
      { total: number; items: Row[]; source_counts?: Record<string, number> },
  });
  const total = list?.total || 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search controls…" className="h-9 w-56 rounded-lg border border-slate-300 pl-8 pr-3 text-[13px] focus:border-primary-500 focus:outline-none" />
        </div>
        <select value={framework} onChange={(e) => { setFramework(e.target.value); setPage(0); }} className="h-9 max-w-[220px] rounded-lg border border-slate-300 px-2 text-[13px]">
          <option value="">All frameworks</option>
          {frameworks.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <select value={domain} onChange={(e) => { setDomain(e.target.value); setPage(0); }} className="h-9 max-w-[220px] rounded-lg border border-slate-300 px-2 text-[13px]">
          <option value="">All domains</option>
          {(domainsData?.domains || []).map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }} className="h-9 rounded-lg border border-slate-300 px-2 text-[13px]">
          <option value="">Any progress</option>
          {['not_started', 'in_progress', 'implemented', 'verified', 'not_applicable'].map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
        <select value={effFilter} onChange={(e) => { setEffFilter(e.target.value); setPage(0); }} className="h-9 rounded-lg border border-slate-300 px-2 text-[13px]">
          <option value="">Any effectiveness</option>
          {['effective', 'partially_effective', 'ineffective', 'not_tested'].map(s => <option key={s} value={s}>{eff(s).label}</option>)}
        </select>
        {due && (
          <button onClick={() => { setDue(''); setPage(0); }} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[12.5px] font-medium text-rose-700 hover:bg-rose-100">
            <Siren className="h-3.5 w-3.5" /> {due === 'overdue' ? 'Overdue only' : 'Scheduled only'} <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {([['all', 'All'], ['framework', 'Framework'], ['internal', 'Internal Control'], ['normalized', 'Normalized']] as const).map(([k, label]) => {
          const active = source === k;
          const dot = k === 'framework' ? 'bg-blue-500' : k === 'internal' ? 'bg-cyan-500' : k === 'normalized' ? 'bg-violet-500' : 'bg-slate-400';
          return (
            <button key={k} type="button" onClick={() => { setSource(k); setPage(0); }}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors ${active ? 'border-primary-400 bg-primary-50 text-primary-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
              {k !== 'all' && <span className={`h-2 w-2 rounded-full ${dot}`} />}{label}
              <span className={`rounded-full px-1.5 text-[10.5px] tabular-nums ${active ? 'bg-primary-100 text-primary-700' : 'bg-slate-100 text-slate-500'}`}>{(list?.source_counts?.[k]) ?? 0}</span>
            </button>
          );
        })}
        <span className="ml-auto text-[12px] text-slate-400">Showing {total.toLocaleString()}</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {isLoading ? <div className="p-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-300" /></div> :
          <ControlTable rows={list?.items || []} onOpenRow={onOpenRow} showDomain />}
      </div>

      {total > LIMIT && (
        <div className="flex items-center justify-end gap-2 text-[12px]">
          <button disabled={page === 0} onClick={() => setPage(p2 => Math.max(0, p2 - 1))} className="rounded border border-slate-200 px-2.5 py-1 disabled:opacity-40">Prev</button>
          <span className="text-slate-500">Page {page + 1} of {Math.ceil(total / LIMIT)}</span>
          <button disabled={(page + 1) * LIMIT >= total} onClick={() => setPage(p2 => p2 + 1)} className="rounded border border-slate-200 px-2.5 py-1 disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
}

// ── VIEW: my work ────────────────────────────────────────────────────────────
function MyWork({ items, onOpenRow }: { items: Row[]; onOpenRow: (r: Row) => void }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      {items.length === 0 ? <div className="p-10 text-center text-[13px] text-slate-400">Nothing assigned to you yet.</div> :
        <ControlTable rows={items} onOpenRow={onOpenRow} showDomain />}
    </div>
  );
}

// ── shared control table ─────────────────────────────────────────────────────
function ControlTable({ rows, onOpenRow, compact, showDomain }: { rows: Row[]; onOpenRow: (r: Row) => void; compact?: boolean; showDomain?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px]">
        <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2.5 font-semibold">Control</th>
            {showDomain && <th className="px-3 py-2.5 font-semibold">Domain</th>}
            <th className="px-3 py-2.5 font-semibold">Source</th>
            <th className="px-3 py-2.5 font-semibold">Progress</th>
            <th className="px-3 py-2.5 font-semibold">Effectiveness</th>
            <th className="px-3 py-2.5 font-semibold">Assignees</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 ? (
            <tr><td colSpan={showDomain ? 6 : 5} className="px-4 py-8 text-center text-slate-400">No controls here.</td></tr>
          ) : rows.map((r) => (
            <tr key={`${r.source_type}-${r.source_id}`} onClick={() => onOpenRow(r)} className="cursor-pointer hover:bg-slate-50">
              <td className={`px-4 ${compact ? 'py-2' : 'py-2.5'}`}>
                <div className="flex items-center gap-2">
                  {r.is_key_control && <Star className="h-3.5 w-3.5 flex-shrink-0 fill-amber-400 text-amber-400" />}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5"><span className="truncate font-medium text-slate-800">{r.name || '—'}</span>{r.overdue && <span className="inline-flex flex-shrink-0 items-center gap-0.5 rounded bg-rose-50 px-1.5 py-0.5 text-[9.5px] font-semibold text-rose-600"><Siren className="h-2.5 w-2.5" />overdue</span>}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-400">
                      {r.code && <span className="max-w-[160px] truncate rounded bg-slate-100 px-1.5 py-px font-mono text-[10px] leading-4 text-slate-500" title={r.code}>{r.code}</span>}
                      {r.framework_name && <span className="truncate">{r.framework_name}</span>}
                    </div>
                  </div>
                </div>
              </td>
              {showDomain && <td className="px-3 py-2 text-[11.5px] text-slate-500">{r.canonical_domain || '—'}</td>}
              <td className="px-3 py-2"><span className={`inline-block rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${(SOURCE_BADGE[r.source_type] || SOURCE_BADGE.framework).cls}`}>{(SOURCE_BADGE[r.source_type] || {}).label}</span>{r.source_type === 'normalized' && (r.member_count || 0) > 0 && <span className="ml-1 text-[10.5px] text-slate-400" title={r.framework_name}>{r.member_count} fw</span>}</td>
              <td className="px-3 py-2"><span className={`inline-block rounded px-1.5 py-0.5 text-[10.5px] font-medium ${IMPL_BADGE[r.implementation_status || 'not_started']}`}>{(r.implementation_status || 'not_started').replace('_', ' ')}</span></td>
              <td className="px-3 py-2"><EffDots d={r.design_effectiveness} o={r.operating_effectiveness} /></td>
              <td className="px-3 py-2">{(r.assignees && r.assignees.length) ? (<div className="flex -space-x-1.5">{r.assignees.slice(0, 3).map(a => <span key={a.id} title={a.display_name} className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-cyan-100 text-[9px] font-semibold text-cyan-700">{initials(a.display_name)}</span>)}{r.assignees.length > 3 && <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-slate-100 text-[9px] text-slate-500">+{r.assignees.length - 3}</span>}</div>) : <span className="text-[11px] text-slate-300">Unassigned</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const inp = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-[13px] focus:border-primary-500 focus:outline-none';
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</span>{children}</label>;
}

// ── Add from Library (promote normalized → catalog) ─────────────────────────
function PromotePicker({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<number[]>([]);
  const { data, isLoading } = useQuery({
    queryKey: ['wb-normalized', q],
    queryFn: async () => (await apiClient.get(`${WB}/normalized?only_unpromoted=true&limit=100${q ? `&q=${encodeURIComponent(q)}` : ''}`)).data as
      { total: number; items: { id: number; code: string; name: string; domain?: string; review_status?: string; frameworks: string[] }[] },
  });
  const promote = useMutation({ mutationFn: async () => apiClient.post(`${WB}/promote`, { normalized_control_ids: sel }), onSuccess: onDone });
  const items = data?.items || [];
  const toggle = (id: number) => setSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  return (
    <RightSlidePanel isOpen onClose={onClose} width="w-full max-w-xl" title="Add controls from the Library"
      subtitle="Promote verified normalized controls into the catalog (comply once → covers their frameworks)"
      footer={<div className="flex items-center justify-between"><span className="text-[12px] text-slate-500">{sel.length} selected</span>
        <div className="flex gap-2"><button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-[13px]">Cancel</button>
          <button disabled={!sel.length || promote.isPending} onClick={() => promote.mutate()} className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-50">{promote.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Promote {sel.length || ''}</button></div></div>}>
      <div className="space-y-2">
        <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search normalized controls…" className="h-9 w-full rounded-lg border border-slate-300 pl-8 pr-3 text-[13px] focus:border-primary-500 focus:outline-none" /></div>
        {isLoading ? <div className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /></div> :
          items.length === 0 ? <div className="py-10 text-center text-[13px] text-slate-400">Nothing left to promote.</div> :
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {items.map(it => (
                <li key={it.id} onClick={() => toggle(it.id)} className={`flex cursor-pointer items-start gap-2.5 p-2.5 hover:bg-slate-50 ${sel.includes(it.id) ? 'bg-violet-50' : ''}`}>
                  <input type="checkbox" checked={sel.includes(it.id)} onChange={() => toggle(it.id)} onClick={e => e.stopPropagation()} className="mt-0.5 h-4 w-4" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><span className="truncate text-[13px] font-medium text-slate-800">{it.name}</span>{it.review_status && <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${it.review_status === 'approved' ? 'bg-emerald-100 text-emerald-700' : it.review_status === 'flagged' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500'}`}>{it.review_status}</span>}</div>
                    <div className="text-[11px] text-slate-400">{it.code}{it.domain ? ` · ${it.domain}` : ''}{it.frameworks?.length ? ` · ${it.frameworks.length} frameworks` : ''}</div>
                  </div>
                </li>
              ))}
            </ul>}
      </div>
    </RightSlidePanel>
  );
}

// ── Create control (→ internal) ─────────────────────────────────────────────
function CreateControl({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ name: '', description: '', category: '', frequency: 'quarterly', priority: 'medium', is_key_control: false });
  const create = useMutation({ mutationFn: async () => (await apiClient.post(`${WB}/controls`, form)).data, onSuccess: onCreated });
  return (
    <RightSlidePanel isOpen onClose={onClose} title="New control" subtitle="Authored as an internal (risk-sourced) control"
      footer={<div className="flex justify-end gap-2"><button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-[13px]">Cancel</button>
        <button disabled={!form.name || create.isPending} onClick={() => create.mutate()} className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-50">{create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Create</button></div>}>
      <div className="space-y-3">
        <Field label="Name"><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={inp} /></Field>
        <Field label="Description"><textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={3} className={inp} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category"><input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="e.g. Operations" className={inp} /></Field>
          <Field label="Frequency"><select value={form.frequency} onChange={e => setForm({ ...form, frequency: e.target.value })} className={inp}>{['daily', 'weekly', 'monthly', 'quarterly', 'annually', 'ad_hoc'].map(f => <option key={f}>{f}</option>)}</select></Field>
          <Field label="Priority"><select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} className={inp}>{['low', 'medium', 'high', 'critical'].map(x => <option key={x}>{x}</option>)}</select></Field>
          <label className="flex items-end gap-2 pb-2 text-[13px] text-slate-600"><input type="checkbox" checked={form.is_key_control} onChange={e => setForm({ ...form, is_key_control: e.target.checked })} /> Key control</label>
        </div>
      </div>
    </RightSlidePanel>
  );
}

// ── per-control drawer ──────────────────────────────────────────────────────
const TABS = [
  { k: 'details', label: 'Details' }, { k: 'evidence', label: 'Sampling' },
  { k: 'procedures', label: 'Test Procedures' }, { k: 'effectiveness', label: 'Design & Effectiveness' },
  { k: 'risks', label: 'Risks' },
] as const;

function WorkbenchDrawer({ row, onClose }: { row: Row; onClose: () => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<typeof TABS[number]['k']>('details');
  const { data: d, isLoading, refetch } = useQuery({
    queryKey: ['wb-detail', row.source_type, row.source_id],
    queryFn: async () => (await apiClient.get(`${WB}/controls/${row.source_type}/${row.source_id}`)).data,
  });
  const { data: users } = useQuery({ queryKey: ['wb-users'], queryFn: async () => (await apiClient.get(`${WB}/tenant-users`)).data as { id: number; display_name: string; email?: string }[] });
  const wid = d?.work_item_id;
  const invalidate = () => { refetch(); qc.invalidateQueries({ queryKey: ['wb-list'] }); qc.invalidateQueries({ queryKey: ['wb-my-work'] }); qc.invalidateQueries({ queryKey: ['wb-overview'] }); };
  const assign = useMutation({ mutationFn: async (ids: number[]) => apiClient.patch(`${WB}/items/${wid}/assign`, { assigned_user_ids: ids }), onSuccess: invalidate });

  return (
    <RightSlidePanel isOpen onClose={onClose} width="w-full max-w-2xl"
      title={<span className="flex items-center gap-2">{row.is_key_control && <Star className="h-4 w-4 fill-amber-400 text-amber-400" />}{d?.name || row.name}</span>}
      subtitle={`${row.code || ''} · ${(SOURCE_BADGE[row.source_type] || {}).label}${d?.framework_name ? ` · ${d.framework_name}` : ''}`}>
      {isLoading || !d ? <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div> : (
        <div>
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-3">
            <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE[d.status || 'draft']}`}>{(d.status || 'draft').replace('_', ' ')}</span>
            <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${IMPL_BADGE[d.implementation_status || 'not_started']}`}>{(d.implementation_status || 'not_started').replace('_', ' ')}</span>
            <div className="ml-auto flex items-center gap-2">
              <div className="flex -space-x-1.5">{(d.assignees || []).map((a: any) => <span key={a.id} title={a.display_name} className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-cyan-100 text-[9px] font-semibold text-cyan-700">{initials(a.display_name)}</span>)}</div>
              <MultiSelectDropdown title="Assign" size="sm" placeholder="Assign…" forceSearch items={(users || []).map(u => ({ value: String(u.id), label: u.display_name, subLabel: u.email }))} selectedValues={(d.assigned_user_ids || []).map(String)} onApply={(v) => assign.mutate(v.map(Number))} />
            </div>
          </div>
          <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
            {TABS.map(t => <button key={t.k} onClick={() => setTab(t.k)} className={`relative px-3 py-1.5 text-[12.5px] font-medium ${tab === t.k ? 'text-primary-700' : 'text-slate-500 hover:text-slate-700'}`}>{t.label}{tab === t.k && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded bg-primary-600" />}</button>)}
          </div>
          {tab === 'details' && <DetailsTab d={d} wid={wid} onSaved={invalidate} />}
          {tab === 'effectiveness' && <EffectivenessTab d={d} wid={wid} onSaved={invalidate} />}
          {tab === 'procedures' && <ProceduresTab d={d} wid={wid} onSaved={invalidate} />}
          {tab === 'evidence' && <EvidenceTab d={d} wid={wid} onSaved={invalidate} />}
          {tab === 'risks' && <RisksTab d={d} wid={wid} onSaved={invalidate} />}
        </div>
      )}
    </RightSlidePanel>
  );
}

function DetailsTab({ d, wid, onSaved }: any) {
  const [f, setF] = useState({ name: d.name || '', description: d.description || '', priority: d.priority || 'medium', is_key_control: !!d.is_key_control, implementation_status: d.implementation_status || 'not_started' });
  const save = useMutation({ mutationFn: async () => apiClient.patch(`${WB}/items/${wid}`, f), onSuccess: onSaved });
  return (
    <div className="space-y-3">
      <Field label="Name"><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} className={inp} /></Field>
      <Field label="Description"><textarea value={f.description} onChange={e => setF({ ...f, description: e.target.value })} rows={4} className={inp} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Priority"><select value={f.priority} onChange={e => setF({ ...f, priority: e.target.value })} className={inp}>{['low', 'medium', 'high', 'critical'].map(x => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Progress"><select value={f.implementation_status} onChange={e => setF({ ...f, implementation_status: e.target.value })} className={inp}>{['not_started', 'in_progress', 'implemented', 'verified', 'not_applicable'].map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select></Field>
      </div>
      <label className="flex items-center gap-2 text-[13px] text-slate-600"><input type="checkbox" checked={f.is_key_control} onChange={e => setF({ ...f, is_key_control: e.target.checked })} /> Key control</label>
      <button onClick={() => save.mutate()} disabled={save.isPending} className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-50">{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save</button>
    </div>
  );
}

function EffectivenessTab({ d, wid, onSaved }: any) {
  const [show, setShow] = useState(false);
  const [t, setT] = useState({ test_type: 'operating', result: 'effective', sample_size: 25, exceptions_found: 0, findings: '', frequency: 'quarterly' });
  const add = useMutation({ mutationFn: async () => apiClient.post(`${WB}/items/${wid}/tests`, t), onSuccess: () => { setShow(false); onSaved(); } });
  const review = useMutation({ mutationFn: async ({ id, action }: any) => apiClient.post(`${WB}/tests/${id}/review`, { action }), onSuccess: onSaved });
  // per-test edit
  const [editId, setEditId] = useState<number | null>(null);
  const [ef, setEf] = useState<{ test_type: string; result: string; sample_size: number; exceptions_found: number; findings: string }>({ test_type: 'operating', result: 'effective', sample_size: 0, exceptions_found: 0, findings: '' });
  const startEdit = (x: any) => { setEditId(x.id); setEf({ test_type: x.test_type || 'operating', result: x.result || 'effective', sample_size: x.sample_size ?? 0, exceptions_found: x.exceptions_found ?? 0, findings: x.findings || '' }); };
  const editM = useMutation({ mutationFn: async () => apiClient.patch(`${WB}/tests/${editId}`, ef), onSuccess: () => { setEditId(null); onSaved(); } });
  const delM = useMutation({ mutationFn: async (id: number) => apiClient.delete(`${WB}/tests/${id}`), onSuccess: () => { setEditId(null); onSaved(); } });
  const nextDate = d.next_test_date ? new Date(d.next_test_date) : null;
  const overdue = nextDate ? nextDate < new Date() : false;
  const daysTo = nextDate ? Math.round((nextDate.getTime() - Date.now()) / 86400000) : null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {(['design_effectiveness', 'operating_effectiveness'] as const).map((k) => (
          <div key={k} className="rounded-lg border border-slate-200 p-3">
            <div className="text-[11px] uppercase tracking-wide text-slate-400">{k === 'design_effectiveness' ? 'Design' : 'Operating'} effectiveness</div>
            <div className={`mt-1 flex items-center gap-1.5 text-[14px] font-semibold ${eff(d[k]).text}`}><span className={`h-2.5 w-2.5 rounded-full ${eff(d[k]).dot}`} />{eff(d[k]).label}</div>
          </div>
        ))}
      </div>

      {/* test schedule status */}
      <div className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-[12px] ${overdue ? 'border-rose-200 bg-rose-50 text-rose-700' : nextDate ? 'border-slate-200 bg-slate-50 text-slate-600' : 'border-dashed border-slate-200 bg-white text-slate-400'}`}>
        <FileClock className="h-4 w-4 flex-shrink-0" />
        {nextDate
          ? <span>{overdue ? <b>Test overdue</b> : 'Next test'} due <b>{nextDate.toISOString().slice(0, 10)}</b>{daysTo != null && <span className="text-slate-400"> · {overdue ? `${-daysTo}d ago` : `in ${daysTo}d`}</span>}{d.frequency && <span className="text-slate-400"> · {d.frequency}</span>}</span>
          : <span>No test cadence set — record a test with a frequency to schedule the next one.</span>}
      </div>

      <div className="flex items-center justify-between"><h4 className="text-[13px] font-semibold text-slate-700">Test history</h4><button onClick={() => setShow(v => !v)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50">{show ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} {show ? 'Cancel' : 'Record test'}</button></div>
      {show && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="mb-0.5 block text-[10px] uppercase tracking-wide text-slate-400">Test type</span><select value={t.test_type} onChange={e => setT({ ...t, test_type: e.target.value })} className={inp}><option value="design">Design</option><option value="operating">Operating</option></select></label>
            <label className="block"><span className="mb-0.5 block text-[10px] uppercase tracking-wide text-slate-400">Result</span><select value={t.result} onChange={e => setT({ ...t, result: e.target.value })} className={inp}>{['effective', 'partially_effective', 'ineffective'].map(r => <option key={r} value={r}>{eff(r).label}</option>)}</select></label>
            <label className="block"><span className="mb-0.5 block text-[10px] uppercase tracking-wide text-slate-400">Sample size</span><input type="number" value={t.sample_size} onChange={e => setT({ ...t, sample_size: +e.target.value })} className={inp} /></label>
            <label className="block"><span className="mb-0.5 block text-[10px] uppercase tracking-wide text-slate-400">Exceptions</span><input type="number" value={t.exceptions_found} onChange={e => setT({ ...t, exceptions_found: +e.target.value })} className={inp} /></label>
            <label className="col-span-2 block"><span className="mb-0.5 block text-[10px] uppercase tracking-wide text-slate-400">Retest cadence (schedules the next test)</span><select value={t.frequency} onChange={e => setT({ ...t, frequency: e.target.value })} className={inp}>{['', 'monthly', 'quarterly', 'semi_annually', 'annually'].map(f => <option key={f} value={f}>{f ? f.replace('_', ' ') : 'no schedule'}</option>)}</select></label>
          </div>
          <textarea value={t.findings} onChange={e => setT({ ...t, findings: e.target.value })} placeholder="Findings" rows={2} className={inp} />
          <button onClick={() => add.mutate()} disabled={add.isPending} className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50">{add.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save test</button>
        </div>
      )}
      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {(d.tests || []).length === 0 ? <div className="p-3 text-[12px] text-slate-400">No tests recorded.</div> :
          (d.tests || []).map((x: any) => editId === x.id ? (
            <div key={x.id} className="space-y-2 bg-slate-50 p-2.5">
              <div className="grid grid-cols-2 gap-2">
                <label className="block"><span className="mb-0.5 block text-[10px] uppercase tracking-wide text-slate-400">Test type</span><select value={ef.test_type} onChange={e => setEf({ ...ef, test_type: e.target.value })} className={inp}><option value="design">Design</option><option value="operating">Operating</option></select></label>
                <label className="block"><span className="mb-0.5 block text-[10px] uppercase tracking-wide text-slate-400">Result</span><select value={ef.result} onChange={e => setEf({ ...ef, result: e.target.value })} className={inp}>{['effective', 'partially_effective', 'ineffective'].map(r => <option key={r} value={r}>{eff(r).label}</option>)}</select></label>
                <label className="block"><span className="mb-0.5 block text-[10px] uppercase tracking-wide text-slate-400">Sample size</span><input type="number" value={ef.sample_size} onChange={e => setEf({ ...ef, sample_size: +e.target.value })} className={inp} /></label>
                <label className="block"><span className="mb-0.5 block text-[10px] uppercase tracking-wide text-slate-400">Exceptions</span><input type="number" value={ef.exceptions_found} onChange={e => setEf({ ...ef, exceptions_found: +e.target.value })} className={inp} /></label>
              </div>
              <textarea value={ef.findings} onChange={e => setEf({ ...ef, findings: e.target.value })} placeholder="Findings" rows={2} className={inp} />
              <div className="flex items-center justify-between">
                <button onClick={() => delM.mutate(x.id)} disabled={delM.isPending} className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1.5 text-[11.5px] font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
                <div className="flex gap-2">
                  <button onClick={() => setEditId(null)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11.5px] text-slate-500">Cancel</button>
                  <button onClick={() => editM.mutate()} disabled={editM.isPending} className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-[11.5px] font-semibold text-white disabled:opacity-50">{editM.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save changes</button>
                </div>
              </div>
            </div>
          ) : (
            <div key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-2.5 text-[12px]">
              <span className="capitalize text-slate-700">{x.test_type} · {x.test_date?.slice(0, 10)}</span>
              <span className={`flex items-center gap-1 font-medium ${eff(x.result).text}`}><span className={`h-2 w-2 rounded-full ${eff(x.result).dot}`} />{eff(x.result).label}{x.exceptions_found ? ` · ${x.exceptions_found} exc` : ''}</span>
              <div className="ml-auto flex items-center gap-1.5">
                {x.status === 'reviewed'
                  ? <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10.5px] font-medium text-emerald-700"><ShieldCheck className="h-3 w-3" /> Signed off{x.reviewer ? ` · ${x.reviewer}` : ''}</span>
                  : <button onClick={() => review.mutate({ id: x.id, action: 'reviewed' })} className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-0.5 text-[10.5px] font-medium text-slate-500 hover:border-emerald-300 hover:text-emerald-700"><Check className="h-3 w-3" /> Sign off</button>}
                <button onClick={() => startEdit(x)} title="Edit this test" className="rounded border border-slate-200 p-1 text-slate-400 hover:border-primary-300 hover:text-primary-600"><Pencil className="h-3 w-3" /></button>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

function ProceduresTab({ d, wid, onSaved }: any) {
  const gen = useMutation({ mutationFn: async () => apiClient.post(`${WB}/items/${wid}/ai-procedures`, {}), onSuccess: onSaved });
  const toggle = useMutation({ mutationFn: async ({ id, checked }: any) => apiClient.patch(`${WB}/procedures/${id}`, { is_checked: checked }), onSuccess: onSaved });
  const attach = useMutation({ mutationFn: async ({ pid, file }: any) => { const fd = new FormData(); fd.append('test_procedure_id', String(pid)); if (file) fd.append('file', file); return apiClient.post(`${WB}/items/${wid}/evidence`, fd); }, onSuccess: onSaved });
  const procs = d.test_procedures || [];
  const evByProc = (pid: number) => (d.evidence || []).filter((e: any) => e.test_procedure_id === pid);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><p className="text-[12px] text-slate-500">Numbered audit test procedures. Check each as you complete it; attach evidence per step (optional).</p>
        <button onClick={() => gen.mutate()} disabled={gen.isPending} className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-violet-700 disabled:opacity-50">{gen.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} {procs.length ? 'Regenerate' : 'Get AI Recommendation'}</button></div>
      {procs.length === 0 ? <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-[12px] text-slate-400">No test procedures yet. Click <b>Get AI Recommendation</b>.</div> :
        <ol className="space-y-2">{procs.map((p: any) => (
          <li key={p.id} className="rounded-lg border border-slate-200 p-2.5"><div className="flex items-start gap-2.5">
            <input type="checkbox" checked={p.is_checked} onChange={e => toggle.mutate({ id: p.id, checked: e.target.checked })} className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2"><span className="text-[11px] font-semibold text-slate-400">{p.seq}.</span>{p.procedure_type && <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">{p.procedure_type}</span>}{p.frequency && <span className="text-[10.5px] text-slate-400">{p.frequency}{p.sample_size ? ` · n=${p.sample_size}` : ''}</span>}</div>
              <p className={`mt-1 text-[12.5px] ${p.is_checked ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{p.description}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-primary-600 hover:text-primary-700"><Upload className="h-3 w-3" /> Attach sample<input type="file" className="hidden" onChange={e => e.target.files?.[0] && attach.mutate({ pid: p.id, file: e.target.files[0] })} /></label>
                {evByProc(p.id).map((e: any) => <span key={e.id} className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10.5px] text-slate-600"><ClipboardCheck className="h-3 w-3" />{e.file_name || 'evidence'} · {e.review_status}</span>)}
              </div>
            </div>
          </div></li>))}</ol>}
    </div>
  );
}

function EvidenceTab({ d, wid, onSaved }: any) {
  const [linking, setLinking] = useState(false);
  const [q, setQ] = useState('');
  const upload = useMutation({ mutationFn: async (file: File) => { const fd = new FormData(); fd.append('file', file); return apiClient.post(`${WB}/items/${wid}/evidence`, fd); }, onSuccess: onSaved });
  const linkExisting = useMutation({ mutationFn: async (evidence_id: number) => { const fd = new FormData(); fd.append('evidence_id', String(evidence_id)); return apiClient.post(`${WB}/items/${wid}/evidence`, fd); }, onSuccess: () => { setLinking(false); setQ(''); onSaved(); } });
  const review = useMutation({ mutationFn: async ({ id, action }: any) => apiClient.post(`${WB}/evidence/${id}/review`, { action }), onSuccess: onSaved });
  const { data: lib, isLoading } = useQuery({
    queryKey: ['wb-evidence-lib', q],
    queryFn: async () => (await apiClient.get(`${WB}/evidence-library?limit=30${q ? `&q=${encodeURIComponent(q)}` : ''}`)).data as
      { items: { id: number; name: string; file_name?: string; evidence_type?: string; status?: string }[] },
    enabled: linking,
  });
  const items = d.evidence || [];
  const linkedEv = new Set(items.map((e: any) => e.evidence_id).filter(Boolean));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-[13px] font-semibold text-white hover:bg-primary-700"><Upload className="h-4 w-4" /> Upload sample<input type="file" className="hidden" disabled={upload.isPending} onChange={e => e.target.files?.[0] && upload.mutate(e.target.files[0])} /></label>
        <button onClick={() => setLinking(v => !v)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-50"><Search className="h-4 w-4" /> Link from library</button>
        {upload.isPending && <span className="inline-flex items-center gap-1 text-[12px] text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> uploading…</span>}
      </div>
      <p className="text-[11px] text-slate-400">Attach the sampled evidence used to test this control. Uploads are saved to the Evidence Library (OCR-processed &amp; reviewable there too).</p>

      {linking && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
          <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search the evidence library…" className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-8 pr-3 text-[13px] focus:border-primary-500 focus:outline-none" /></div>
          {isLoading ? <div className="py-4 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-slate-300" /></div> :
            <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 bg-white">
              {(lib?.items || []).filter(e => !linkedEv.has(e.id)).length === 0 ?
                <li className="p-3 text-center text-[12px] text-slate-400">Nothing to link.</li> :
                (lib?.items || []).filter(e => !linkedEv.has(e.id)).map(e => (
                  <li key={e.id} className="flex items-center gap-2.5 p-2.5 hover:bg-slate-50">
                    <ClipboardCheck className="h-4 w-4 flex-shrink-0 text-slate-400" />
                    <div className="min-w-0 flex-1"><div className="truncate text-[12.5px] font-medium text-slate-800">{e.name}</div><div className="text-[11px] text-slate-400">{e.evidence_type || 'evidence'}{e.status ? ` · ${e.status}` : ''}</div></div>
                    <button disabled={linkExisting.isPending} onClick={() => linkExisting.mutate(e.id)} className="inline-flex flex-shrink-0 items-center gap-1 rounded-md bg-primary-600 px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-primary-700 disabled:opacity-50">{linkExisting.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Link</button>
                  </li>
                ))}
            </ul>}
        </div>
      )}

      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {items.length === 0 ? <div className="p-3 text-[12px] text-slate-400">No samples attached yet.</div> :
          items.map((e: any) => (
            <div key={e.id} className="flex items-center justify-between gap-2 p-2.5 text-[12.5px]">
              <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-slate-700"><ClipboardCheck className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />{e.file_name || 'evidence'}{e.test_procedure_id ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">step-linked</span> : ''}{e.evidence_id ? <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600">in library</span> : ''}</span>
              <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium ${e.review_status === 'approved' ? 'bg-emerald-100 text-emerald-700' : e.review_status === 'rejected' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>{e.review_status}</span>
              {e.review_status === 'pending' && <span className="flex gap-1"><button onClick={() => review.mutate({ id: e.id, action: 'approved' })} className="rounded p-1 text-emerald-600 hover:bg-emerald-50" title="Approve"><Check className="h-3.5 w-3.5" /></button><button onClick={() => review.mutate({ id: e.id, action: 'rejected' })} className="rounded p-1 text-rose-600 hover:bg-rose-50" title="Reject"><X className="h-3.5 w-3.5" /></button></span>}
            </div>
          ))}
      </div>
    </div>
  );
}

const riskBand = (s?: number | null) =>
  s == null ? { c: 'text-slate-400', bg: 'bg-slate-100', l: '—' }
    : s >= 15 ? { c: 'text-rose-700', bg: 'bg-rose-100', l: String(s) }
      : s >= 8 ? { c: 'text-amber-700', bg: 'bg-amber-100', l: String(s) }
        : { c: 'text-emerald-700', bg: 'bg-emerald-100', l: String(s) };

function RisksTab({ d, wid, onSaved }: any) {
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const del = useMutation({ mutationFn: async (id: number) => apiClient.delete(`${WB}/risks/${id}`), onSuccess: onSaved });
  const add = useMutation({ mutationFn: async (risk_id: number) => apiClient.post(`${WB}/items/${wid}/risks`, { risk_id }), onSuccess: () => { setAdding(false); setQ(''); onSaved(); } });
  const { data: riskList, isLoading } = useQuery({
    queryKey: ['wb-risks', q],
    queryFn: async () => (await apiClient.get(`${WB}/risks?limit=50${q ? `&q=${encodeURIComponent(q)}` : ''}`)).data as
      { items: { id: number; title: string; category?: string; residual_score?: number; status?: string }[] },
    enabled: adding,
  });
  const links = d.risk_links || [];
  const linkedIds = new Set(links.map((l: any) => l.risk_id));
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-slate-500">Risks this control mitigates. Internal controls carry their risk links across automatically.</p>
        <button onClick={() => setAdding(v => !v)} className="inline-flex flex-shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50">
          {adding ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} {adding ? 'Close' : 'Link a risk'}
        </button>
      </div>

      {adding && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
          <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search the risk register…" className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-8 pr-3 text-[13px] focus:border-primary-500 focus:outline-none" /></div>
          {isLoading ? <div className="py-4 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-slate-300" /></div> :
            <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 bg-white">
              {(riskList?.items || []).filter(r => !linkedIds.has(r.id)).length === 0 ?
                <li className="p-3 text-center text-[12px] text-slate-400">No matching risks to link.</li> :
                (riskList?.items || []).filter(r => !linkedIds.has(r.id)).map(r => {
                  const b = riskBand(r.residual_score);
                  return (
                    <li key={r.id} className="flex items-center gap-2.5 p-2.5 hover:bg-slate-50">
                      <span className={`flex h-7 w-8 flex-shrink-0 items-center justify-center rounded text-[11px] font-bold ${b.bg} ${b.c}`} title="Residual score">{b.l}</span>
                      <div className="min-w-0 flex-1"><div className="truncate text-[12.5px] font-medium text-slate-800">{r.title}</div><div className="text-[11px] text-slate-400">{r.category}{r.status ? ` · ${r.status}` : ''}</div></div>
                      <button disabled={add.isPending} onClick={() => add.mutate(r.id)} className="inline-flex flex-shrink-0 items-center gap-1 rounded-md bg-primary-600 px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-primary-700 disabled:opacity-50">{add.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Link</button>
                    </li>
                  );
                })}
            </ul>}
        </div>
      )}

      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {links.length === 0 ? <div className="p-3 text-[12px] text-slate-400">No linked risks yet — click <b>Link a risk</b> to connect this control to your risk register.</div> :
          links.map((r: any) => {
            const b = riskBand(r.risk_residual_score);
            return (
              <div key={r.id} className="flex items-center gap-2.5 p-2.5 text-[12.5px]">
                <span className={`flex h-7 w-8 flex-shrink-0 items-center justify-center rounded text-[11px] font-bold ${b.bg} ${b.c}`} title="Residual score">{b.l}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-slate-700">{r.risk_title || `Risk #${r.risk_id}`}</div>
                  <div className="text-[11px] text-slate-400">{r.risk_category ? `${r.risk_category} · ` : ''}{r.link_type}{r.effectiveness_rating ? ` · ${r.effectiveness_rating}` : ''}</div>
                </div>
                <button onClick={() => del.mutate(r.id)} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Unlink"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            );
          })}
      </div>
    </div>
  );
}

function WorkflowTab({ d, wid, onSaved }: any) {
  const act = useMutation({ mutationFn: async (a: string) => apiClient.post(`${WB}/items/${wid}/${a}`, {}), onSuccess: onSaved });
  const [esc, setEsc] = useState({ escalation_name: '', trigger_condition: 'test_failure', trigger_threshold: 3 });
  const addEsc = useMutation({ mutationFn: async () => apiClient.post(`${WB}/items/${wid}/escalations`, esc), onSuccess: () => { setEsc({ escalation_name: '', trigger_condition: 'test_failure', trigger_threshold: 3 }); onSaved(); } });
  const delEsc = useMutation({ mutationFn: async (id: number) => apiClient.delete(`${WB}/escalations/${id}`), onSuccess: onSaved });
  const st = d.status || 'draft';
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 p-3">
        <div className="mb-2 flex items-center gap-2 text-[12.5px]"><span className="text-slate-500">Approval status:</span><span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE[st]}`}>{st.replace('_', ' ')}</span></div>
        <div className="flex gap-2">
          {(st === 'draft' || st === 'inactive') && <button onClick={() => act.mutate('submit')} className="rounded-lg bg-amber-500 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-amber-600">Submit for approval</button>}
          {st === 'pending_approval' && <><button onClick={() => act.mutate('approve')} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-emerald-700">Approve</button><button onClick={() => act.mutate('reject')} className="rounded-lg bg-rose-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-rose-700">Reject</button></>}
          {st === 'active' && <span className="text-[12px] text-emerald-600">✓ Approved &amp; active</span>}
        </div>
      </div>
      <div>
        <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-slate-700"><AlertTriangle className="h-4 w-4 text-amber-500" /> Escalation rules</div>
        <div className="mb-2 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-2.5">
          <input value={esc.escalation_name} onChange={e => setEsc({ ...esc, escalation_name: e.target.value })} placeholder="Rule name (e.g. Manager review)" className={`${inp} flex-1`} />
          <select value={esc.trigger_condition} onChange={e => setEsc({ ...esc, trigger_condition: e.target.value })} className={inp}>{['test_failure', 'overdue_test', 'exception_found'].map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}</select>
          <button onClick={() => addEsc.mutate()} disabled={!esc.escalation_name || addEsc.isPending} className="rounded-lg bg-primary-600 px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-50">Add</button>
        </div>
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {(d.escalations || []).length === 0 ? <div className="p-3 text-[12px] text-slate-400">No escalation rules.</div> :
            (d.escalations || []).map((e: any) => <div key={e.id} className="flex items-center justify-between p-2.5 text-[12.5px]"><span className="text-slate-700">L{e.escalation_level} · {e.escalation_name} <span className="text-slate-400">({e.trigger_condition?.replace('_', ' ')})</span></span><button onClick={() => delEsc.mutate(e.id)} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button></div>)}
        </div>
      </div>
    </div>
  );
}
