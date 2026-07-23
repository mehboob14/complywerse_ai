'use client';

/**
 * NCA — one workspace page with a top-bar of tabs (PDPL-style), mirroring the
 * Cyber Security hub.
 *
 *  • Overview  = a data-wired dashboard. Each KPI opens its own DRILL-DOWN
 *                page that shows WHERE that metric comes from (broken down per
 *                assessment) so you can navigate into the specific assessment.
 *  • Each other tab = a dedicated sub-page rendering the real assessment
 *                component. Active tab is reflected in the URL (?tab=).
 */
import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import {
  LayoutDashboard, Bug, ArrowRight, ArrowLeft, ShieldCheck,
  TrendingUp, ClipboardList, AlertTriangle,
} from 'lucide-react';
import DccToolTab from '@/components/compliance/DccToolTab';
import NcaRegisterTab from '@/components/compliance/NcaRegisterTab';

type TabKey = 'overview' | 'dcc' | 'nca_vuln' | 'nca_audit' | 'nca_risk';
type DrillKind = 'gaps' | 'coverage' | 'compliant' | 'started';

type Feature = { key: TabKey; label: string; icon: React.ElementType; group: string; format: string };

const FEATURES: Feature[] = [
  { key: 'dcc', label: 'DCC Assessment', icon: ShieldCheck, group: 'Essential Controls', format: 'nca_dcc_tool' },
  { key: 'nca_vuln', label: 'Vulnerability Register', icon: Bug, group: 'Registers', format: 'nca_vuln_register' },
  { key: 'nca_audit', label: 'Audit Plan', icon: ClipboardList, group: 'Registers', format: 'nca_audit_register' },
  { key: 'nca_risk', label: 'Risk Management', icon: AlertTriangle, group: 'Registers', format: 'nca_risk_register' },
];

const TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  ...FEATURES.map((f) => ({ key: f.key, label: f.label, icon: f.icon })),
];
const VALID = new Set<TabKey>(TABS.map((t) => t.key));

function renderFeature(tab: TabKey): React.ReactNode {
  switch (tab) {
    case 'dcc': return <DccToolTab />;
    case 'nca_vuln': return <NcaRegisterTab kind="vuln" />;
    case 'nca_audit': return <NcaRegisterTab kind="audit" />;
    case 'nca_risk': return <NcaRegisterTab kind="risk" />;
    default: return null;
  }
}

interface RawAssessment {
  id: number; name: string; assessment_format?: string; status: string;
  overall_score: number | null; total_items: number | null;
  complied_count: number | null; partially_complied_count: number | null;
  not_complied_count: number | null; in_progress_count: number | null; na_count: number | null;
}

interface Row {
  f: Feature; started: boolean;
  total: number; assessed: number; complied: number; partial: number;
  notc: number; inprog: number; na: number; score: number; coverage: number; gaps: number;
}

const scoreColor = (pct: number) => (pct >= 70 ? '#10b981' : pct >= 40 ? '#f59e0b' : '#ef4444');

// Aggregate control-status mix across every assessment in this hub.
const STATUS_SEGMENTS: { key: keyof Row; label: string; color: string }[] = [
  { key: 'complied', label: 'Complied', color: '#10b981' },
  { key: 'partial', label: 'Partial', color: '#f59e0b' },
  { key: 'notc', label: 'Not complied', color: '#ef4444' },
  { key: 'inprog', label: 'In progress', color: '#6366f1' },
  { key: 'na', label: 'N/A', color: '#cbd5e1' },
];

// Shared query + row computation (react-query caches by key, so the dashboard
// and every drill-down view reuse one fetch).
function useNcaRows(): { rows: Row[]; isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ['nca-assessments'],
    queryFn: async () => {
      const r = await apiClient.get('/compliance/assessments', { params: { skip: 0, limit: 100 } });
      return (r.data?.assessments ?? r.data ?? []) as RawAssessment[];
    },
  });

  const byFormat = new Map<string, RawAssessment>();
  for (const a of data ?? []) {
    if (a.assessment_format && FEATURES.some((f) => f.format === a.assessment_format)) {
      const prev = byFormat.get(a.assessment_format);
      if (!prev || (a.total_items ?? 0) > (prev.total_items ?? 0)) byFormat.set(a.assessment_format, a);
    }
  }

  const rows: Row[] = FEATURES.map((f) => {
    const a = byFormat.get(f.format);
    const complied = a?.complied_count || 0;
    const partial = a?.partially_complied_count || 0;
    const notc = a?.not_complied_count || 0;
    const inprog = a?.in_progress_count || 0;
    const na = a?.na_count || 0;
    const total = a?.total_items || complied + partial + notc + inprog + na;
    const assessed = complied + partial + notc + na;
    return {
      f, started: !!a, total, assessed, complied, partial, notc, inprog, na,
      score: Math.round(a?.overall_score ?? 0),
      coverage: total > 0 ? Math.round((assessed / total) * 100) : 0,
      gaps: notc + inprog,
    };
  });
  return { rows, isLoading };
}

function Kpi({ label, value, sub, icon: Icon, onClick, hint }: {
  label: string; value: React.ReactNode; sub?: string; icon: React.ElementType;
  onClick?: () => void; hint?: string;
}) {
  const Comp: React.ElementType = onClick ? 'button' : 'div';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`group block w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-[0_2px_10px_-2px_rgba(15,23,42,0.10)] transition-all duration-200 ${
        onClick ? 'cursor-pointer hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-[0_12px_28px_-8px_rgba(15,23,42,0.18)]' : ''
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
        <Icon className="h-4 w-4 text-slate-300" />
      </div>
      <div className="mt-1.5 text-[26px] font-bold leading-none text-slate-900">{value}</div>
      {sub && <div className="mt-1 text-[11.5px] text-slate-400">{sub}</div>}
      {onClick && (
        <div className="mt-2 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-primary-600 opacity-60 transition-opacity group-hover:opacity-100">
          {hint || 'Break down'} <ArrowRight className="h-3 w-3 -translate-x-0.5 transition-transform group-hover:translate-x-0" />
        </div>
      )}
    </Comp>
  );
}

function OverviewDashboard({ onDrill, onOpen }: { onDrill: (k: DrillKind) => void; onOpen: (t: TabKey) => void }) {
  const { rows, isLoading } = useNcaRows();

  const started = rows.filter((r) => r.started).length;
  const totItems = rows.reduce((s, r) => s + r.total, 0);
  const totAssessed = rows.reduce((s, r) => s + r.assessed, 0);
  const totComplied = rows.reduce((s, r) => s + r.complied, 0);
  const totGaps = rows.reduce((s, r) => s + r.gaps, 0);
  const coverage = totItems > 0 ? Math.round((totAssessed / totItems) * 100) : 0;
  const compliantPct = totAssessed > 0 ? Math.round((totComplied / totAssessed) * 100) : 0;

  // Aggregate status mix (drives the stacked bar under the KPI tiles).
  const agg = STATUS_SEGMENTS.reduce((acc, s) => {
    acc[s.key] = rows.reduce((sum, r) => sum + (r[s.key] as number), 0);
    return acc;
  }, {} as Record<keyof Row, number>);
  const statusTotal = STATUS_SEGMENTS.reduce((sum, s) => sum + agg[s.key], 0);

  // Per-assessment compliance (complied / assessed) for the "by assessment" panel.
  const byAssessment = rows.map((r) => ({
    r, pct: r.assessed > 0 ? Math.round((r.complied / r.assessed) * 100) : 0,
  }));
  const topGaps = rows.filter((r) => r.gaps > 0).sort((a, b) => b.gaps - a.gaps).slice(0, 5);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-28 rounded-2xl" />)}
        </div>
        <div className="skeleton h-64 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── KPI tiles (click to break a metric down per assessment) ── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Assessments started" value={`${started}/${FEATURES.length}`} sub={`${FEATURES.length - started} not started`} icon={ClipboardList} hint="Break down" onClick={() => onDrill('started')} />
        <Kpi label="Coverage" value={`${coverage}%`} sub={`${totAssessed} of ${totItems} controls assessed`} icon={TrendingUp} hint="Break down" onClick={() => onDrill('coverage')} />
        <Kpi label="Compliant" value={`${compliantPct}%`} sub={`${totComplied} of assessed controls`} icon={ShieldCheck} hint="Break down" onClick={() => onDrill('compliant')} />
        <Kpi label="Open gaps" value={totGaps} sub="Not complied + in progress" icon={AlertTriangle} hint="Break down" onClick={() => onDrill('gaps')} />
      </div>

      {/* ── Aggregate control-status mix across every assessment ── */}
      {statusTotal > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_2px_10px_-2px_rgba(15,23,42,0.10)]">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">Control status across all assessments</h4>
            <span className="text-[10px] text-slate-400">{statusTotal} controls</span>
          </div>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
            {STATUS_SEGMENTS.map((s) => {
              const v = agg[s.key];
              return v > 0 ? <div key={s.key} title={`${s.label}: ${v}`} style={{ width: `${(v / statusTotal) * 100}%`, backgroundColor: s.color }} /> : null;
            })}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5">
            {STATUS_SEGMENTS.map((s) => (
              <span key={s.key} className="inline-flex items-center gap-1.5 text-[11px] text-slate-600">
                <span className="h-2.5 w-2.5 rounded" style={{ backgroundColor: s.color }} />
                {s.label} <span className="font-semibold tabular-nums text-slate-500">{agg[s.key]}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Compliance by assessment + What to fix first (equal height) ── */}
      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_2px_10px_-2px_rgba(15,23,42,0.10)]">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">Compliance by assessment</h4>
            <span className="text-[10px] text-slate-400">click to open</span>
          </div>
          <div className="space-y-0.5">
            {byAssessment.map(({ r, pct }, i) => {
              const tone = r.assessed > 0 ? scoreColor(pct) : '#cbd5e1';
              return (
                <button key={r.f.key} onClick={() => onOpen(r.f.key)} className="group flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-500/10 text-[10px] font-bold text-primary-700">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium text-slate-700" title={r.f.label}>{r.f.label}</span>
                      <span className="shrink-0 text-[11px] font-bold" style={{ color: tone }}>{r.assessed > 0 ? `${pct}%` : '—'}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: tone }} /></div>
                  </div>
                  {r.gaps > 0 && <span className="shrink-0 rounded-full bg-red-50 px-1.5 text-[10px] font-bold text-red-600" title={`${r.gaps} gap(s)`}>{r.gaps}</span>}
                  <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 group-hover:text-slate-500" />
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_2px_10px_-2px_rgba(15,23,42,0.10)]">
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">
            <AlertTriangle className="h-3.5 w-3.5 text-rose-500" /> What to fix first
          </h4>
          {topGaps.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">No open gaps — assess more controls to surface work here.</p>
          ) : (
            <div className="space-y-0.5">
              {topGaps.map((r) => {
                const Icon = r.f.icon;
                return (
                  <button key={r.f.key} onClick={() => onOpen(r.f.key)} className="group flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-slate-50">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-600"><Icon className="h-3.5 w-3.5" /></span>
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-slate-800">{r.f.label}</span>
                      <span className="text-[10.5px] text-slate-400">{r.notc} not complied · {r.inprog} in progress</span>
                    </div>
                    <span className="shrink-0 text-base font-bold tabular-nums text-rose-600">{r.gaps}</span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 group-hover:text-primary-500" />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Drill-down: WHERE a metric comes from, broken down per assessment ───────
const DRILL_META: Record<DrillKind, {
  title: string; blurb: string; icon: React.ElementType; color: string;
  value: (r: Row) => number; label: (r: Row) => string; detail: (r: Row) => string;
  sort: (a: Row, b: Row) => number;
}> = {
  gaps: {
    title: 'Open gaps', blurb: 'Controls that are not complied or still in progress — where your remediation work is.',
    icon: AlertTriangle, color: '#ef4444',
    value: (r) => r.gaps, label: (r) => `${r.gaps}`,
    detail: (r) => `${r.notc} not complied · ${r.inprog} in progress`,
    sort: (a, b) => b.gaps - a.gaps,
  },
  coverage: {
    title: 'Coverage', blurb: 'How much of each assessment has been assessed. Least-covered first — that is where to focus.',
    icon: TrendingUp, color: '#6366f1',
    value: (r) => r.coverage, label: (r) => `${r.coverage}%`,
    detail: (r) => `${r.assessed} of ${r.total} controls assessed`,
    sort: (a, b) => a.coverage - b.coverage,
  },
  compliant: {
    title: 'Compliant controls', blurb: 'Controls scored as complied, per assessment.',
    icon: ShieldCheck, color: '#10b981',
    value: (r) => r.complied, label: (r) => `${r.complied}`,
    detail: (r) => `${r.assessed > 0 ? Math.round((r.complied / r.assessed) * 100) : 0}% of assessed`,
    sort: (a, b) => b.complied - a.complied,
  },
  started: {
    title: 'Assessments', blurb: 'Every NCA assessment and whether it has been started.',
    icon: ClipboardList, color: '#0ea5e9',
    value: (r) => r.total, label: (r) => (r.started ? `${r.total}` : '—'),
    detail: (r) => (r.started ? `${r.total} controls` : 'Not started'),
    sort: (a, b) => Number(b.started) - Number(a.started) || b.total - a.total,
  },
};

function DrillView({ kind, onOpen, onBack }: { kind: DrillKind; onOpen: (t: TabKey) => void; onBack: () => void }) {
  const { rows, isLoading } = useNcaRows();
  const meta = DRILL_META[kind];
  const Icon = meta.icon;

  // For metric drills, only assessments with data are meaningful; the "started"
  // drill shows all (started + not started).
  const list = (kind === 'started' ? rows : rows.filter((r) => r.started)).slice().sort(meta.sort);
  const max = Math.max(1, ...list.map((r) => meta.value(r)));
  const totalValue = kind === 'coverage'
    ? undefined
    : rows.reduce((s, r) => s + meta.value(r), 0);

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 transition-colors hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Back to overview
      </button>

      <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_2px_10px_-2px_rgba(15,23,42,0.10)]">
        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `${meta.color}1a`, color: meta.color }}>
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900">{meta.title}</h2>
            {totalValue !== undefined && (
              <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ backgroundColor: `${meta.color}1a`, color: meta.color }}>{totalValue} total</span>
            )}
          </div>
          <p className="mt-0.5 max-w-2xl text-[12.5px] text-slate-500">{meta.blurb}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-16 rounded-xl" />)}</div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_2px_10px_-2px_rgba(15,23,42,0.10)]">
          <div className="divide-y divide-slate-100">
            {list.map((r) => {
              const RowIcon = r.f.icon;
              const val = meta.value(r);
              const disabled = kind !== 'started' && val === 0;
              return (
                <button
                  key={r.f.key}
                  type="button"
                  onClick={() => onOpen(r.f.key)}
                  className="group flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-slate-50"
                >
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary-500/10 text-primary-600">
                    <RowIcon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-slate-900">{r.f.label}</span>
                      {!r.started && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Not started</span>}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="relative h-1.5 w-40 max-w-[38vw] overflow-hidden rounded-full bg-slate-100">
                        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(val / max) * 100}%`, backgroundColor: disabled ? '#cbd5e1' : meta.color }} />
                      </span>
                      <span className="text-[11px] text-slate-400">{meta.detail(r)}</span>
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <div className="text-lg font-bold tabular-nums" style={{ color: disabled ? '#cbd5e1' : meta.color }}>{meta.label(r)}</div>
                  </div>
                  <span className="flex flex-shrink-0 items-center gap-1 text-[11px] font-semibold text-slate-400 transition-colors group-hover:text-primary-600">
                    Open <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function NcaWorkspace() {
  const router = useRouter();
  const params = useSearchParams();
  const initial = (params.get('tab') as TabKey) || 'overview';
  const [active, setActive] = useState<TabKey>(VALID.has(initial) ? initial : 'overview');
  const [drill, setDrill] = useState<DrillKind | null>(null);

  const openTab = (t: TabKey) => {
    setDrill(null);
    setActive(t);
    router.replace(t === 'overview' ? '/nca' : `/nca?tab=${t}`, { scroll: false });
  };

  let panel: React.ReactNode;
  if (active !== 'overview') panel = renderFeature(active);
  else if (drill) panel = <DrillView kind={drill} onOpen={openTab} onBack={() => setDrill(null)} />;
  else panel = <OverviewDashboard onDrill={setDrill} onOpen={openTab} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-slate-100 p-1 scrollbar-thin">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => openTab(key)}
            className={`inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              active === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      <div>{panel}</div>
    </div>
  );
}

export default function NcaPage() {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-slate-400">Loading…</div>}>
      <NcaWorkspace />
    </Suspense>
  );
}
