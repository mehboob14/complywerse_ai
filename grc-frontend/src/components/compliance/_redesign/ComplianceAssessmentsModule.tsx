'use client';

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Search, Bell, Download, Plus, ChevronRight, ChevronDown, ChevronLeft,
  Paperclip, Sparkles, Upload, FileText, X, LayoutGrid, Loader2, AlertTriangle, Eye, Save,
  Gauge, ShieldCheck, Layers, Clock, ArrowUpRight, ListChecks, TrendingUp, type LucideIcon,
} from 'lucide-react';
import {
  StatusBadge, PriorityBadge, AssessmentStatusBadge, ComplianceRing, StatusMixBar,
  STATUS_STYLES, scoreColor, riskColor,
} from './complianceStyles';
import { SAMPLE_ASSESSMENTS, SAMPLE_CONTROLS, FRAMEWORK_TABS } from './sampleData';
import type { Assessment, ControlItem, ComplianceStatus, Priority, DetailApi, EvidenceRow, AiRec, NewControl, SlaPoint } from './types';
import { SlaClosurePanel, type SlaContext } from './SlaClosurePanel';
import { computeRollup, pointScore, averageScore, rollupScore, fmtDate, DEFAULT_SLA_POLICY, type SlaPolicy, type SlaItemInput } from './slaEngine';
import AssessmentsBoardOverview from './AssessmentsBoardOverview';

/**
 * Self-contained Compliance Assessments module (Overview → framework lists →
 * assessment detail → control side panel). Drop-in client component; swap the
 * SAMPLE_* imports for react-query data and lift `view`/filters to the router
 * when wiring to the real app. Tailwind + lucide-react only.
 *
 * Brand teal #1ed4b0 (fills use near-black text), teal-700 #0f766e for teal text,
 * purple for AI. Matches styles/tokens.css and AssessmentInlinePanel.tsx.
 */

const TEAL = '#1ed4b0';
const TEAL_DARK = '#17b898';
const ON_TEAL = '#06342d';

/**
 * Per-assessment item terminology. Only framework assessments call their line
 * items "controls"; Internal Audit records "observations" and PDPL records
 * "points". Used across the cards, lists and detail pages so the noun always
 * matches the assessment type.
 */
function itemNoun(framework?: string): { one: string; many: string; One: string; Many: string } {
  if (framework === 'internal_audit') return { one: 'observation', many: 'observations', One: 'Observation', Many: 'Observations' };
  if (framework === 'pdpl') return { one: 'point', many: 'points', One: 'Point', Many: 'Points' };
  return { one: 'control', many: 'controls', One: 'Control', Many: 'Controls' };
}

type View = 'overview' | 'list' | 'detail';

export default function ComplianceAssessmentsModule({
  assessments = SAMPLE_ASSESSMENTS,
  controls = SAMPLE_CONTROLS,
  embedded = false,
  loadControls,
  onUpload,
  renderTab,
  api,
  slaPoints = [],
  slaPolicy,
  onSlaPolicyChange,
  initialTab,
}: {
  assessments?: Assessment[];
  controls?: ControlItem[];
  /** Active tab to open on mount (from the /assessments/<framework> route). */
  initialTab?: string;
  /** When true, drop the module's own sidebar + topbar (the app provides them). */
  embedded?: boolean;
  /** Live loader for a selected assessment's controls (real data). */
  loadControls?: (a: Assessment) => Promise<ControlItem[]>;
  /** Open the real upload flow. */
  onUpload?: () => void;
  /** Optional per-tab override — return a node to replace the generic list
   *  (used to keep the dedicated NCA / PDPL workspaces). */
  renderTab?: (tabKey: string) => ReactNode | null | undefined;
  /** Real backend wiring for the detail view (evidence, AI, add control, export). */
  api?: DetailApi;
  /** Flat points across all assessments — feeds the closure board. */
  slaPoints?: SlaPoint[];
  /** Tenant SLA policy + persist handler. */
  slaPolicy?: SlaPolicy;
  onSlaPolicyChange?: (p: SlaPolicy) => void;
}) {
  const [view, setView] = useState<View>('overview');
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedId, setSelectedId] = useState<Assessment['id']>(assessments[0]?.id);
  const [search, setSearch] = useState('');

  const tabLabel = FRAMEWORK_TABS.find((t) => t.key === activeTab)?.label ?? '';
  const selected = assessments.find((a) => a.id === selectedId) ?? assessments[0];

  const go = (tab: string) => {
    setActiveTab(tab);
    if (tab === 'overview') { setView('overview'); return; }
    // Dedicated workspaces (NCA / PDPL) keep their own view via renderTab.
    const dedicated = renderTab ? renderTab(tab) !== undefined : false;
    if (dedicated) { setView('list'); return; }
    // Regular framework: open its assessment directly (no list-of-one page).
    const inFramework = assessments.filter((a) => a.framework === tab);
    if (inFramework.length >= 1) { setSelectedId(inFramework[0].id); setView('detail'); }
    else { setView('list'); } // 0 assessments → framework empty state
  };
  const openAssessment = (id: Assessment['id']) => { setSelectedId(id); setView('detail'); };
  const backToOverview = () => { setActiveTab('overview'); setView('overview'); };

  // Open the tab named by the route (/assessments/<framework>). Re-run once
  // assessments finish loading so a framework with data lands on its detail.
  useEffect(() => {
    if (!initialTab || initialTab === 'overview') { setActiveTab('overview'); setView('overview'); return; }
    go(initialTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab, assessments.length]);

  return (
    <div className={embedded ? 'w-full font-sans text-slate-900' : 'flex min-h-screen w-full bg-slate-100 font-sans text-slate-900'}>
      {!embedded && (
      <aside className="sticky top-0 flex h-screen w-[228px] shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex h-[60px] items-center gap-2.5 border-b border-slate-100 px-5">
          <div className="flex h-7 w-7 items-center justify-center rounded-[7px] text-[15px] font-bold" style={{ background: TEAL, color: ON_TEAL }}>C</div>
          <div className="text-[15.5px] font-bold tracking-tight">ComplyVerse</div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 p-3">
          <div className="px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-400">Workspace</div>
          {[
            ['Dashboard', false], ['Governance', false], ['Risk Management', false],
            ['Compliance', true], ['Auditor Portal', false], ['IT Assets', false], ['Critical Tasks', false],
          ].map(([label, active]) => (
            <div key={label as string}
              onClick={() => active && go('overview')}
              className={`flex cursor-pointer items-center gap-3 rounded-[9px] px-3 py-2 text-[13.5px] ${active ? 'font-semibold' : 'font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
              style={active ? { background: '#e7faf5', color: '#0f766e' } : undefined}>
              <span className={`h-1.5 w-1.5 rounded-full ${active ? '' : 'bg-slate-300'}`} style={active ? { background: TEAL } : undefined} />
              {label}
            </div>
          ))}
        </nav>
        <div className="flex items-center gap-2.5 border-t border-slate-100 p-4">
          <div className="flex h-[30px] w-[30px] items-center justify-center rounded-full text-[12px] font-semibold" style={{ background: '#e7faf5', color: '#0f766e' }}>SK</div>
          <div className="min-w-0">
            <div className="truncate text-[12.5px] font-semibold">Sara Khan</div>
            <div className="text-[11px] text-slate-400">Compliance Officer</div>
          </div>
        </div>
      </aside>
      )}

      {/* Main column */}
      <div className={embedded ? 'min-w-0 flex-1' : 'flex min-w-0 flex-1 flex-col'}>
        {!embedded && (
        <header className="sticky top-0 z-20 flex h-[60px] shrink-0 items-center gap-4 border-b border-slate-200 bg-white/85 px-7 backdrop-blur">
          <div className="flex items-center gap-2 text-[13px] text-slate-500">
            <span>Compliance</span><span className="text-slate-300">/</span>
            <span className="font-semibold text-slate-900">Assessments</span>
          </div>
          <div className="flex-1" />
          <div className="flex h-[34px] w-[280px] items-center gap-2 rounded-[9px] border border-slate-200 bg-slate-50 px-3 text-[13px] text-slate-400">
            <Search className="h-[15px] w-[15px]" style={{ color: '#0f766e' }} />
            <span>Ask ComplyChat anything…</span>
          </div>
          <button className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] border border-slate-200 text-slate-500"><Bell className="h-[17px] w-[17px]" /></button>
        </header>
        )}

        <main className={embedded ? 'pb-10' : 'flex-1 px-7 pb-14 pt-6'}>
          {/* Module header */}
          <div className="mb-[18px] flex items-end justify-between gap-6">
            <div>
              <h1 className="m-0 text-[22px] font-bold tracking-tight">Compliance Assessments</h1>
              <p className="mt-1.5 text-[13.5px] text-slate-500">Upload a workbook, score controls, attach evidence, and track gaps to closure.</p>
            </div>
            {!embedded && (
              <div className="flex shrink-0 gap-2.5">
                <button className="inline-flex h-[38px] items-center gap-2 rounded-[9px] border border-slate-200 bg-white px-3.5 text-[13px] font-semibold text-slate-600 hover:bg-slate-50">
                  <LayoutGrid className="h-[15px] w-[15px]" /> Style guide
                </button>
              </div>
            )}
          </div>

          {/* Tabs — hidden when navigation is driven by the sidebar dropdown
              (the /assessments/<framework> routes each pass an initialTab). */}
          {!initialTab && (
          <div className="mb-[22px] flex items-center gap-0.5 overflow-x-auto border-b border-slate-200">
            {FRAMEWORK_TABS.map((t) => {
              const active = (view === 'overview' && t.key === 'overview') || (view !== 'overview' && activeTab === t.key);
              const count = t.key === 'overview' ? 0 : assessments.filter((a) => a.framework === t.key).length;
              return (
                <button key={t.key} onClick={() => go(t.key)}
                  className="relative flex items-center gap-2 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-[13px] font-semibold"
                  style={active ? { color: '#0f766e', borderColor: TEAL } : { color: '#64748b', borderColor: 'transparent' }}>
                  {t.label}
                  {count > 0 && (
                    <span className="min-w-[18px] rounded-full px-1.5 text-center text-[11px] font-bold"
                      style={active ? { background: '#e7faf5', color: '#0f766e' } : { background: '#f1f5f9', color: '#94a3b8' }}>{count}</span>
                  )}
                </button>
              );
            })}
          </div>
          )}

          {view === 'overview' && <AssessmentsBoardOverview onOpen={(id) => openAssessment(id)} slaPoints={slaPoints} slaPolicy={slaPolicy} onSlaPolicyChange={onSlaPolicyChange} />}
          {view === 'list' && (
            renderTab?.(activeTab) ?? (
              <FrameworkList
                assessments={assessments.filter((a) => a.framework === activeTab)}
                tabLabel={tabLabel} search={search} setSearch={setSearch} onOpen={openAssessment} onUpload={onUpload}
              />
            )
          )}
          {view === 'detail' && selected && (
            loadControls ? (
              <DetailLoader
                assessment={selected} loadControls={loadControls} api={api}
                backLabel={initialTab ? undefined : 'Overview'}
                onBack={initialTab ? undefined : backToOverview}
                slaPolicy={slaPolicy} onSlaPolicyChange={onSlaPolicyChange}
              />
            ) : (
              <AssessmentDetail
                assessment={selected} controls={controls} api={api}
                backLabel={initialTab ? undefined : 'Overview'}
                onBack={initialTab ? undefined : backToOverview}
                slaPolicy={slaPolicy} onSlaPolicyChange={onSlaPolicyChange}
              />
            )
          )}
        </main>
      </div>
    </div>
  );
}

/* ---------------- Overview ---------------- */
function Overview({ assessments, onOpen, slaPoints = [], slaPolicy, onSlaPolicyChange }: {
  assessments: Assessment[];
  onOpen: (id: Assessment['id']) => void;
  slaPoints?: SlaPoint[];
  slaPolicy?: SlaPolicy;
  onSlaPolicyChange?: (p: SlaPolicy) => void;
}) {
  const [filter, setFilter] = useState<'all' | 'attention' | 'in_review' | 'completed'>('all');
  const [sort, setSort] = useState<'score' | 'gaps' | 'name'>('score');

  // Board-level KPIs + per-assessment SLA rollup (as of today). Each
  // assessment's score is its own bottom-up, date-weighted roll-up.
  const boardPol = slaPolicy ?? DEFAULT_SLA_POLICY;
  const { boardKpis, slaByAssessment } = useMemo(() => {
    const groups = new Map<Assessment['id'], { format: string; items: SlaItemInput[] }>();
    for (const p of slaPoints) {
      const k = p.assessment_id as Assessment['id'];
      if (!groups.has(k)) groups.set(k, { format: p.assessment_format, items: [] });
      groups.get(k)!.items.push(p as SlaItemInput);
    }
    const now = Date.now();
    const roll = computeRollup(slaPoints as SlaItemInput[], now, boardPol.due_soon_days, boardPol);
    const byId = new Map<Assessment['id'], { overdue: number; dueSoon: number; open: number; closure: number; score: number }>();
    const scores: number[] = [];
    let atRisk = 0;
    for (const [id, g] of groups) {
      const r = computeRollup(g.items, now, boardPol.due_soon_days, boardPol);
      const sc = rollupScore(g.items, now, boardPol.due_soon_days, boardPol, (it) => domainKey(it, g.format)) ?? 0;
      byId.set(id, { overdue: r.overdue, dueSoon: r.dueSoon, open: r.open, closure: r.closureRate, score: sc });
      scores.push(sc);
      if (r.overdue > 0) atRisk++;
    }
    const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    return {
      boardKpis: { assessments: groups.size, atRisk, overdue: roll.overdue, dueSoon: roll.dueSoon, avgScore, points: roll.total, closed: roll.closed, closure: roll.closureRate },
      slaByAssessment: byId,
    };
  }, [slaPoints, boardPol]);

  let rows = assessments.slice();
  if (filter === 'attention') rows = rows.filter((a) => a.status !== 'completed' && ((slaByAssessment.get(a.id)?.overdue ?? 0) > 0 || a.openGaps > 0 || a.score < 70));
  else if (filter === 'in_review') rows = rows.filter((a) => a.status === 'in_review');
  else if (filter === 'completed') rows = rows.filter((a) => a.status === 'completed');
  rows.sort((x, y) => (sort === 'gaps' ? y.openGaps - x.openGaps : sort === 'name' ? x.name.localeCompare(y.name) : y.score - x.score));

  const total = assessments.length;
  const chip = (active: boolean) =>
    `rounded-lg border px-2.5 py-[5px] text-[12px] font-semibold transition-colors ${active ? 'border-[#9fe7d8] bg-[#e7faf5] text-[#0f766e]' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`;

  return (
    <div className="space-y-6">
      {/* ── Portfolio header ── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-bold tracking-tight text-slate-900">Portfolio overview</h2>
          <p className="mt-0.5 text-[12.5px] text-slate-500">{total} assessments · {boardKpis.points.toLocaleString()} points · every point scored on its own SLA timeline</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11.5px] font-semibold"
          style={boardKpis.atRisk > 0 ? { borderColor: '#fecdd3', background: '#fff1f2', color: '#e11d48' } : { borderColor: '#a7f3d0', background: '#ecfdf5', color: '#047857' }}>
          <AlertTriangle className="h-3.5 w-3.5" /> {boardKpis.atRisk} need attention
        </span>
      </div>

      {/* ── Hero KPIs ── */}
      <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(178px, 1fr))' }}>
        <Kpi Icon={LayoutGrid} label="Assessments" value={boardKpis.assessments} sub={`${boardKpis.atRisk} with overdue points`} tone="teal" />
        <Kpi Icon={Gauge} label="Avg score" value={`${boardKpis.avgScore}%`} sub="date-weighted roll-up" tone="emerald" />
        <Kpi Icon={ShieldCheck} label="Closure" value={`${boardKpis.closure}%`} sub={`${boardKpis.closed.toLocaleString()} of ${boardKpis.points.toLocaleString()} closed`} tone="sky" />
        <Kpi Icon={AlertTriangle} label="Overdue points" value={boardKpis.overdue} sub={`${boardKpis.dueSoon} due soon`} tone="rose" />
        <Kpi Icon={Layers} label="Total points" value={boardKpis.points.toLocaleString()} sub={`across ${boardKpis.assessments} assessments`} tone="slate" />
      </div>

      {/* ── SLA / closure (dates-based, time-travel) ── */}
      <SlaClosurePanel
        items={slaPoints}
        policy={slaPolicy}
        onPolicyChange={onSlaPolicyChange}
        title="Portfolio closure & SLA"
        footer={(ctx) => <PerAuditClosure points={slaPoints} ctx={ctx} onOpen={onOpen} />}
      />

      {/* ── All assessments ── */}
      <section>
        <div className="mb-3.5 flex flex-wrap items-center gap-3">
          <span className="flex h-[27px] w-[27px] items-center justify-center rounded-lg" style={{ background: '#e7faf5', color: '#0f766e' }}><ListChecks className="h-[15px] w-[15px]" /></span>
          <h2 className="text-[16px] font-bold tracking-tight">All assessments</h2>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">{rows.length}</span>
          <div className="flex-1" />
          <div className="flex items-center gap-1.5">
            {([['all', 'All'], ['attention', 'Needs attention'], ['in_review', 'In review'], ['completed', 'Completed']] as const).map(([v, l]) => (
              <button key={v} onClick={() => setFilter(v)} className={chip(filter === v)}>{l}</button>
            ))}
          </div>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Sort</span>
          <div className="flex items-center gap-1.5">
            {([['score', 'Compliance'], ['gaps', 'Open gaps'], ['name', 'Name']] as const).map(([v, l]) => (
              <button key={v} onClick={() => setSort(v)} className={chip(sort === v)}>{l}</button>
            ))}
          </div>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
          {rows.map((a) => {
            const sla = slaByAssessment.get(a.id);
            return (
              <div key={a.id} onClick={() => onOpen(a.id)}
                className="group flex cursor-pointer flex-col gap-3.5 rounded-[14px] border border-slate-200 bg-white p-[18px] transition-all hover:border-[#9fe7d8] hover:shadow-[0_10px_28px_-14px_rgba(15,23,42,0.22)]">
                <div className="flex items-start justify-between gap-2.5">
                  <div className="min-w-0">
                    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#0f766e' }}>{a.type}</div>
                    <div className="text-[15px] font-bold leading-tight tracking-tight">{a.name}</div>
                  </div>
                  <SlaCardPill sla={sla} fallback={<AssessmentStatusBadge status={a.status} />} />
                </div>
                <div className="flex items-center gap-4">
                  <ComplianceRing score={a.score} size={78} stroke={8} />
                  <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                    <StatusMixBar counts={a.counts} />
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                      {([['complied', 'Complied'], ['partially_complied', 'Partial'], ['in_progress', 'In Progress'], ['not_complied', 'Not Complied']] as [ComplianceStatus, string][]).map(([k, label]) => (
                        <div key={k} className="flex items-center gap-1.5 text-[11.5px] text-slate-500">
                          <span className={`h-2 w-2 rounded-sm ${STATUS_STYLES[k].dot}`} />
                          <span className="flex-1 truncate">{label}</span>
                          <span className="font-semibold text-slate-700">{countFor(a, k)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="mt-px flex items-center border-t border-slate-100 pt-3">
                  <Stat label={itemNoun(a.framework).Many} value={a.total} />
                  <Divider />
                  <Stat label="Overdue" value={sla?.overdue ?? 0} color={(sla?.overdue ?? 0) > 0 ? '#e11d48' : '#047857'} />
                  <Divider />
                  <Stat label="Open gaps" value={a.openGaps} color={a.openGaps > 0 ? '#9a3412' : '#047857'} />
                </div>
              </div>
            );
          })}
        </div>
        {rows.length === 0 && (
          <div className="rounded-[14px] border-[1.5px] border-dashed border-slate-300 bg-white px-6 py-12 text-center text-[13.5px] text-slate-500">No assessments match this filter.</div>
        )}
      </section>
    </div>
  );
}

/* Per-assessment SLA posture pill for the card header — overdue > due-soon >
   on-track. Falls back to the plain status badge when the assessment has no
   dated points. */
function SlaCardPill({ sla, fallback }: { sla?: { overdue: number; dueSoon: number; open: number }; fallback: React.ReactNode }) {
  if (!sla) return <>{fallback}</>;
  if (sla.overdue > 0) return <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: '#fff1f2', color: '#e11d48' }}><AlertTriangle className="h-3 w-3" />{sla.overdue} overdue</span>;
  if (sla.dueSoon > 0) return <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: '#fffbeb', color: '#b45309' }}><Clock className="h-3 w-3" />{sla.dueSoon} due soon</span>;
  return <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: '#ecfdf5', color: '#047857' }}><ShieldCheck className="h-3 w-3" />on track</span>;
}
function countFor(a: Assessment, k: ComplianceStatus) {
  if (k === 'complied') return a.counts.complied;
  if (k === 'partially_complied') return a.counts.partial;
  if (k === 'in_progress') return a.counts.in_progress;
  if (k === 'not_complied') return a.counts.not_complied;
  return a.counts.na;
}
function Stat({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div className="flex-1 text-center">
      <div className="text-[16px] font-bold" style={color ? { color } : undefined}>{value}</div>
      <div className="text-[10.5px] text-slate-400">{label}</div>
    </div>
  );
}
const Divider = () => <div className="h-[26px] w-px bg-slate-100" />;

/* Domain key for the bottom-up score. Internal Audit stores its domain as
   "<Domain> - <suffix>"; collapse to the "<Domain>" prefix so the board's
   assessment score matches the domains shown on the detail page. */
function domainKey(it: SlaItemInput, format: string): string {
  const dom = ((it as { area_domain?: string | null }).area_domain || 'Uncategorized').trim();
  if (format === 'ubl_audit_master_tracking') { const sep = dom.indexOf(' - '); return sep > 0 ? dom.slice(0, sep).trim() : dom; }
  return dom;
}

/* Closure table for the board — ONE row per actual assessment (matches the
   top-bar tabs). Each assessment's score is the bottom-up roll-up of its own
   domains; its internal domains live on the assessment's detail page. */
function PerAuditClosure({ points, ctx, onOpen }: {
  points: SlaPoint[];
  ctx: SlaContext;
  onOpen: (id: Assessment['id']) => void;
}) {
  const groups = useMemo(() => {
    const m = new Map<Assessment['id'], { id: Assessment['id']; name: string; type: string; format: string; items: SlaItemInput[] }>();
    for (const p of points) {
      const k = p.assessment_id as Assessment['id'];
      if (!m.has(k)) m.set(k, { id: k, name: p.assessment_name, type: p.assessment_type, format: p.assessment_format, items: [] });
      m.get(k)!.items.push(p as SlaItemInput);
    }
    return [...m.values()]
      .map((g) => ({
        ...g,
        roll: computeRollup(g.items, ctx.asOfMs, ctx.horizon, ctx.policy),
        score: rollupScore(g.items, ctx.asOfMs, ctx.horizon, ctx.policy, (it) => domainKey(it, g.format)) ?? 0,
      }))
      .sort((a, b) => b.roll.overdue - a.roll.overdue || b.roll.open - a.roll.open);
  }, [points, ctx]);

  if (groups.length === 0) return <div className="py-3 text-center text-[12.5px] text-slate-400">No points yet. Upload an assessment to populate the board.</div>;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-[12.5px] font-bold tracking-tight text-slate-700">Closure by assessment</h4>
        <span className="text-[11px] text-slate-400">as of {fmtDate(ctx.asOfMs)} · click to open</span>
      </div>
      <div className="overflow-hidden rounded-[11px] border border-slate-200">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-slate-50 text-left text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
              <th className="px-3 py-2">Assessment</th>
              <th className="px-2 py-2 text-right">Points</th>
              <th className="px-2 py-2 text-right">Open</th>
              <th className="px-2 py-2 text-right">Overdue</th>
              <th className="px-2 py-2 text-right">Due soon</th>
              <th className="px-3 py-2">Score</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.id} onClick={() => onOpen(g.id)} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2.5">
                  <div className="truncate font-semibold text-slate-800">{g.name}</div>
                  <div className="text-[10.5px] text-slate-400">{g.type}</div>
                </td>
                <td className="px-2 py-2.5 text-right font-semibold text-slate-700">{g.roll.total}</td>
                <td className="px-2 py-2.5 text-right text-slate-600">{g.roll.open}</td>
                <td className="px-2 py-2.5 text-right font-semibold" style={{ color: g.roll.overdue > 0 ? '#e11d48' : '#94a3b8' }}>{g.roll.overdue}</td>
                <td className="px-2 py-2.5 text-right" style={{ color: g.roll.dueSoon > 0 ? '#b45309' : '#94a3b8' }}>{g.roll.dueSoon}</td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2" title="Audit score = average of its points' own date-vs-status scores">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${g.score}%`, backgroundColor: scoreColor(g.score) }} /></div>
                    <span className="w-9 text-right font-semibold text-slate-700">{g.score}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- Framework list ---------------- */
function FrameworkList({
  assessments, tabLabel, search, setSearch, onOpen, onUpload,
}: {
  assessments: Assessment[]; tabLabel: string; search: string;
  setSearch: (v: string) => void; onOpen: (id: Assessment['id']) => void; onUpload?: () => void;
}) {
  const term = search.trim().toLowerCase();
  const rows = assessments.filter((a) => !term || a.name.toLowerCase().includes(term) || a.assessor.toLowerCase().includes(term));
  const avg = assessments.length ? Math.round(assessments.reduce((s, a) => s + a.score, 0) / assessments.length) : 0;
  const totGaps = assessments.reduce((s, a) => s + a.openGaps, 0);
  const totControls = assessments.reduce((s, a) => s + a.total, 0);
  const noun = itemNoun(assessments[0]?.framework);

  return (
    <div>
      <div className="mb-[18px] grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <Kpi label="Assessments" value={assessments.length} sub={`${tabLabel} framework`} tone="teal" Icon={LayoutGrid} />
        <Kpi label="Avg. compliance" value={`${avg}%`} sub="Weighted across assessments" tone="emerald" Icon={Gauge} />
        <Kpi label={noun.Many} value={totControls} sub={`Total in ${tabLabel || 'framework'}`} tone="slate" Icon={Layers} />
        <Kpi label="Open gaps" value={totGaps} sub="Awaiting remediation" tone="amber" Icon={AlertTriangle} />
      </div>

      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <div className="flex h-[38px] w-[260px] items-center gap-2 rounded-[9px] border border-slate-200 bg-white px-3">
          <Search className="h-[15px] w-[15px] text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search assessments…"
            className="w-full flex-1 border-0 bg-transparent text-[13px] outline-none" />
        </div>
        <div className="flex-1" />
        <button onClick={onUpload} className="inline-flex h-[38px] items-center gap-2 rounded-[9px] px-4 text-[13px] font-semibold" style={{ background: TEAL, color: ON_TEAL }}><Upload className="h-[14px] w-[14px]" /> Upload {tabLabel} Excel</button>
      </div>

      {rows.length > 0 ? (
        <div className="overflow-hidden rounded-[13px] border border-slate-200 bg-white">
          <table className="w-full table-fixed border-collapse">
            <colgroup><col /><col style={{ width: 140 }} /><col style={{ width: 104 }} /><col style={{ width: 178 }} /><col style={{ width: 140 }} /><col style={{ width: 128 }} /><col style={{ width: 56 }} /></colgroup>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
                <th className="px-[18px] py-2.5">Assessment</th><th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5 text-right">{noun.Many}</th><th className="px-3 py-2.5">Compliance</th>
                <th className="px-3 py-2.5">Assessor</th><th className="px-3 py-2.5">Due</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} onClick={() => onOpen(a.id)} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-[18px] py-3.5">
                    <div className="truncate text-[13.5px] font-semibold">{a.name}</div>
                    <div className="mt-0.5 text-[11.5px] text-slate-400">{a.domainCount} domains · {a.source}</div>
                  </td>
                  <td className="px-3 py-3.5"><AssessmentStatusBadge status={a.status} /></td>
                  <td className="px-3 py-3.5 text-right text-[13.5px] font-semibold text-slate-700">{a.total}</td>
                  <td className="px-3 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <div className="h-1.5 min-w-[54px] flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full" style={{ width: `${a.score}%`, background: scoreColor(a.score) }} />
                      </div>
                      <span className="w-[34px] text-right text-[12.5px] font-bold">{a.score}%</span>
                    </div>
                  </td>
                  <td className="truncate px-3 py-3.5 text-[13px] text-slate-600">{a.assessor}</td>
                  <td className="px-3 py-3.5 text-[13px] text-slate-600">{a.due}</td>
                  <td className="px-3 py-3.5 text-center text-slate-300"><ChevronRight className="inline h-4 w-4" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-[14px] border-[1.5px] border-dashed border-slate-300 bg-white px-6 py-14 text-center">
          <div className="mx-auto mb-4 flex h-[54px] w-[54px] items-center justify-center rounded-[13px]" style={{ background: '#e7faf5' }}>
            <FileText className="h-[26px] w-[26px]" style={{ color: '#0f766e' }} />
          </div>
          <div className="mb-1.5 text-[15px] font-bold">No {tabLabel} assessment yet</div>
          <div className="mx-auto mb-[18px] max-w-[380px] text-[13px] text-slate-500">Upload the {tabLabel} workbook and we&apos;ll parse it with this framework&apos;s template into domains and controls automatically.</div>
          <button onClick={onUpload} className="inline-flex h-[38px] items-center gap-2 rounded-[9px] px-4 text-[13px] font-semibold" style={{ background: TEAL, color: ON_TEAL }}><Upload className="h-[15px] w-[15px]" /> Upload {tabLabel} Excel</button>
        </div>
      )}
    </div>
  );
}
const KPI_TONES = {
  teal: { bg: '#e7faf5', fg: '#0f766e' }, emerald: { bg: '#ecfdf5', fg: '#047857' },
  sky: { bg: '#eff6ff', fg: '#0369a1' }, slate: { bg: '#f1f5f9', fg: '#475569' },
  amber: { bg: '#fffbeb', fg: '#9a3412' }, rose: { bg: '#fff1f2', fg: '#e11d48' },
} as const;

function Kpi({ label, value, sub, tone, Icon }: {
  label: string; value: React.ReactNode; sub?: string;
  tone: keyof typeof KPI_TONES; Icon: LucideIcon;
}) {
  const t = KPI_TONES[tone];
  return (
    <div className="rounded-[14px] border border-slate-200 bg-white p-[17px] transition-shadow hover:shadow-[0_6px_20px_-14px_rgba(15,23,42,0.25)]">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
        <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px]" style={{ background: t.bg, color: t.fg }}><Icon className="h-[17px] w-[17px]" /></span>
      </div>
      <div className="mt-1.5 text-[26px] font-bold leading-none tracking-tight tabular-nums">{value}</div>
      {sub && <div className="mt-2 text-[11.5px] text-slate-400">{sub}</div>}
    </div>
  );
}

/* ---------------- Detail loader (real data) ---------------- */
function DetailLoader({
  assessment, loadControls, backLabel, onBack, api, slaPolicy, onSlaPolicyChange,
}: {
  assessment: Assessment; loadControls: (a: Assessment) => Promise<ControlItem[]>;
  backLabel?: string; onBack?: () => void; api?: DetailApi;
  slaPolicy?: SlaPolicy; onSlaPolicyChange?: (p: SlaPolicy) => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['redesign-controls', assessment.id],
    queryFn: () => loadControls(assessment),
    staleTime: 30_000,
  });
  const backBtn = onBack ? (
    <button onClick={onBack} className="mb-3.5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-500 hover:text-[#0f766e]">
      <ChevronLeft className="h-[15px] w-[15px]" /> Back to {backLabel || 'Overview'}
    </button>
  ) : null;
  if (isLoading) {
    return (
      <div>
        {backBtn}
        <div className="flex items-center justify-center rounded-[14px] border border-slate-200 bg-white py-20">
          <Loader2 className="h-6 w-6 animate-spin" style={{ color: '#0f766e' }} />
        </div>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div>
        {backBtn}
        <div className="rounded-[14px] border border-slate-200 bg-white px-6 py-12 text-center text-[13.5px] text-slate-500">Failed to load this assessment's controls.</div>
      </div>
    );
  }
  return <AssessmentDetail assessment={assessment} controls={data} backLabel={backLabel} onBack={onBack} api={api} slaPolicy={slaPolicy} onSlaPolicyChange={onSlaPolicyChange} />;
}

/* ---------------- Detail ---------------- */
function AssessmentDetail({
  assessment, controls, backLabel, onBack, api, slaPolicy, onSlaPolicyChange,
}: {
  assessment: Assessment; controls: ControlItem[]; backLabel?: string; onBack?: () => void; api?: DetailApi;
  slaPolicy?: SlaPolicy; onSlaPolicyChange?: (p: SlaPolicy) => void;
}) {
  // Which domain the "Add item" drawer is open for (null = closed). The button
  // lives on each domain header, so a new item is always scoped to its domain.
  const [addDomain, setAddDomain] = useState<string | null>(null);
  const noun = itemNoun(assessment.framework);
  const reuploadRef = useRef<HTMLInputElement>(null);
  const [reuploading, setReuploading] = useState(false);
  const onReupload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !api) return;
    setReuploading(true);
    try {
      const r = await api.reupload(assessment.id, file);
      const u = r?.updated_count ?? 0; const a = r?.added_count ?? 0;
      alert(`Assessment refreshed from ${file.name}: ${u} updated, ${a} added.`);
    } catch { alert('Re-upload failed. Check the file format.'); }
    finally { setReuploading(false); if (reuploadRef.current) reuploadRef.current.value = ''; }
  };
  // Domains start collapsed — the detail shows just the domain list; selecting a
  // domain reveals its controls. (Filters still force-expand matching domains.)
  const [openDomains, setOpenDomains] = useState<Set<string>>(() => new Set());
  const [modalItem, setModalItem] = useState<ControlItem | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ComplianceStatus>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | Priority>('all');
  const [gapsOnly, setGapsOnly] = useState(false);
  const [panel, setPanel] = useState<{ item: ControlItem; tab: 'details' | 'evidence' | 'ai' } | null>(null);

  const cc = controls.filter((c) => c.compliance_status === 'complied').length;
  const cp = controls.filter((c) => c.compliance_status === 'partially_complied').length;
  const cip = controls.filter((c) => c.compliance_status === 'in_progress').length;
  const cn = controls.filter((c) => c.compliance_status === 'not_complied').length;
  const cna = controls.filter((c) => c.compliance_status === 'na').length;
  const slaPol = slaPolicy ?? DEFAULT_SLA_POLICY;
  // Headline score is the bottom-up SLA rollup: each point's own date-vs-status
  // score → averaged per domain → averaged across domains. No flat compliance %.
  const score = rollupScore(controls as SlaItemInput[], Date.now(), slaPol.due_soon_days, slaPol, (c) => (c as ControlItem).area_domain) ?? 0;
  const counts = { complied: cc, partial: cp, not_complied: cn, in_progress: cip, na: cna };
  const criticalOpen = controls.filter((c) => c.priority === 'critical' && (c.compliance_status === 'not_complied' || c.compliance_status === 'in_progress')).length;
  const verdict = score >= 80 ? { t: 'Audit ready', c: 'text-emerald-800 bg-emerald-100 border-emerald-200' }
    : score >= 60 ? { t: 'On track', c: 'text-blue-800 bg-blue-100 border-blue-200' }
    : score >= 40 ? { t: 'Needs attention', c: 'text-amber-800 bg-amber-100 border-amber-200' }
    : { t: 'At risk', c: 'text-rose-800 bg-rose-100 border-rose-200' };

  const term = search.trim().toLowerCase();
  const domains = useMemo(() => {
    const names = [...new Set(controls.map((c) => c.area_domain))];
    return names.map((name) => {
      const all = controls.filter((c) => c.area_domain === name);
      let items = all;
      if (statusFilter !== 'all') items = items.filter((c) => c.compliance_status === statusFilter);
      if (priorityFilter !== 'all') items = items.filter((c) => c.priority === priorityFilter);
      if (gapsOnly) items = items.filter((c) => c.compliance_status === 'not_complied' || c.compliance_status === 'in_progress' || c.compliance_status === 'partially_complied');
      if (term) items = items.filter((c) => c.control_description.toLowerCase().includes(term) || c.item_number.toLowerCase().includes(term) || (c.responsible_party ?? '').toLowerCase().includes(term));
      const pct = Math.round(((all.filter((c) => c.compliance_status === 'complied').length + all.filter((c) => c.compliance_status === 'partially_complied').length * 0.5) / Math.max(1, all.length)) * 100);
      return { name, all, items, pct };
    });
  }, [controls, statusFilter, priorityFilter, gapsOnly, term]);

  const toggleDomain = (n: string) => setOpenDomains((s) => { const x = new Set(s); x.has(n) ? x.delete(n) : x.add(n); return x; });

  // Any filter active → hide domains with no matches and force-expand the rest
  // so results are always visible (a collapsed domain would otherwise hide them).
  const filtersActive = statusFilter !== 'all' || priorityFilter !== 'all' || gapsOnly || term !== '';
  const visibleDomains = filtersActive ? domains.filter((d) => d.items.length > 0) : domains;
  const matchCount = domains.reduce((n, d) => n + d.items.length, 0);
  const clearFilters = () => { setSearch(''); setStatusFilter('all'); setPriorityFilter('all'); setGapsOnly(false); };

  // Which optional fields each domain actually uses (inferred from its existing
  // controls) — drives which fields the "Add item" form shows per selected domain.
  const domainFields = useMemo(() => {
    const OPTIONAL = ['responsible_party', 'timeline', 'priority', 'gaps_identified', 'proposed_solution', 'remarks', 'evidence_reference'];
    const map: Record<string, Set<string>> = {};
    for (const c of controls) {
      const dom = c.area_domain;
      if (!map[dom]) map[dom] = new Set<string>();
      for (const f of OPTIONAL) {
        const v = (c as unknown as Record<string, unknown>)[f];
        if (v !== null && v !== undefined && String(v).trim() !== '') map[dom].add(f);
      }
    }
    return map;
  }, [controls]);

  return (
    <div>
      {onBack && (
        <button onClick={onBack} className="mb-3.5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-500 hover:text-[#0f766e]">
          <ChevronLeft className="h-[15px] w-[15px]" /> Back to {backLabel || 'Overview'}
        </button>
      )}

      <div className="mb-[18px] flex flex-wrap items-start justify-between gap-5">
        <div>
          <div className="mb-1.5 flex items-center gap-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#0f766e' }}>{assessment.type}</span>
            <AssessmentStatusBadge status={assessment.status} />
          </div>
          <h2 className="m-0 text-[21px] font-bold tracking-tight">{assessment.name}</h2>
          <div className="mt-1.5 text-[12.5px] text-slate-400">Assessor {assessment.assessor} · Due {assessment.due} · Source {assessment.source}</div>
        </div>
        <div className="flex gap-2.5">
          <input ref={reuploadRef} type="file" accept=".xlsx,.xls,.csv,.pdf" className="hidden" onChange={onReupload} />
          <button onClick={() => api?.exportReport(assessment)} className="inline-flex h-[38px] items-center gap-2 rounded-[9px] border border-slate-200 bg-white px-3.5 text-[13px] font-semibold text-slate-600 hover:bg-slate-50"><Download className="h-[14px] w-[14px]" /> Export report</button>
          <button onClick={() => reuploadRef.current?.click()} disabled={reuploading} title={`Import an updated ${assessment.type} Excel — it uses this assessment's template, extracts the data, and refreshes every control`} className="inline-flex h-[38px] items-center gap-2 rounded-[9px] px-4 text-[13px] font-semibold disabled:opacity-60" style={{ background: TEAL, color: ON_TEAL }}>
            {reuploading ? <Loader2 className="h-[14px] w-[14px] animate-spin" /> : <Upload className="h-[14px] w-[14px]" />} {reuploading ? 'Uploading…' : 'Upload Excel'}
          </button>
        </div>
      </div>

      {/* Compact summary — audit score + closure counts, as of today. The heavy
          board panel (as-of scrubber / Tune SLA / aging) lives on the Overview. */}
      {(() => {
        const roll = computeRollup(controls as SlaItemInput[], Date.now(), slaPol.due_soon_days, slaPol);
        const band = score >= 80 ? 'strong' : score >= 50 ? 'fair' : 'weak';
        return (
          <div className="mb-5 grid grid-cols-1 gap-3 lg:grid-cols-[240px_1fr]">
            {/* Audit-score card */}
            <div className="flex items-center gap-3.5 rounded-[14px] border border-slate-200 bg-white p-4 shadow-sm"
              title="Audit score = average of each point's own date-vs-status score">
              <div className="flex h-[64px] w-[64px] flex-shrink-0 items-center justify-center rounded-full" style={{ background: `conic-gradient(${scoreColor(score)} ${score * 3.6}deg, #eef2f6 0deg)` }}>
                <div className="flex h-[50px] w-[50px] items-center justify-center rounded-full bg-white text-[15px] font-bold" style={{ color: scoreColor(score) }}>{score}%</div>
              </div>
              <div>
                <div className="text-[13.5px] font-bold text-slate-800">Audit score</div>
                <div className="text-[11px] text-slate-400">avg of point scores</div>
                <span className="mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ backgroundColor: `${scoreColor(score)}18`, color: scoreColor(score) }}>{band}</span>
              </div>
            </div>
            {/* KPI cards */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
              <Kpi label={noun.Many} value={roll.total} tone="slate" Icon={ListChecks} sub="in this assessment" />
              <Kpi label="Open" value={roll.open} tone="amber" Icon={Clock} sub={`${roll.dueSoon} due soon`} />
              <Kpi label="Overdue" value={roll.overdue} tone="rose" Icon={AlertTriangle} sub="past target date" />
              <Kpi label="Closed" value={roll.closed} tone="emerald" Icon={ShieldCheck} sub="remediated" />
              <Kpi label="Closure" value={`${roll.closureRate}%`} tone="sky" Icon={TrendingUp} sub={`${roll.closed} of ${roll.total}`} />
            </div>
          </div>
        );
      })()}

      {/* Filter bar */}
      <div className="mb-3.5 flex flex-wrap items-center gap-3.5">
        <div className="flex h-9 w-[240px] items-center gap-2 rounded-[9px] border border-slate-200 bg-white px-3">
          <Search className="h-3.5 w-3.5 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${noun.many}…`} className="w-full flex-1 border-0 bg-transparent text-[13px] outline-none" />
        </div>
        <ChipGroup label="Status" value={statusFilter} onChange={(v) => setStatusFilter(v as any)}
          options={[['all', 'All'], ['complied', 'Complied'], ['partially_complied', 'Partial'], ['in_progress', 'In Progress'], ['not_complied', 'Not Complied']]} />
        <ChipGroup label="Priority" value={priorityFilter} onChange={(v) => setPriorityFilter(v as any)}
          options={[['all', 'All'], ['critical', 'Critical'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']]} />
        <div className="flex-1" />
        <button onClick={() => setGapsOnly((v) => !v)}
          className={`rounded-lg border px-2.5 py-[5px] text-[12px] font-semibold ${gapsOnly ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}>
          {gapsOnly ? 'Gaps only · on' : 'Gaps only'}
        </button>
      </div>

      {/* Filter results summary */}
      {filtersActive && (
        <div className="mb-2.5 flex items-center gap-2 text-[12px] text-slate-500">
          <span><span className="font-semibold text-slate-700">{matchCount}</span> {matchCount === 1 ? noun.one : noun.many} match{matchCount === 1 ? 'es' : ''} your filters</span>
          <button onClick={clearFilters} className="font-semibold" style={{ color: '#0f766e' }}>Clear filters</button>
        </div>
      )}

      {/* Domain accordions */}
      <div className="flex flex-col gap-3">
        {visibleDomains.map((d) => {
          const open = filtersActive ? true : openDomains.has(d.name);
          const pol = slaPolicy ?? DEFAULT_SLA_POLICY;
          return (
            <div key={d.name} className="overflow-hidden rounded-[13px] border border-slate-200 bg-white">
              <div className="flex w-full items-center gap-3.5 px-[18px] py-[15px] hover:bg-[#fbfcfe]">
                <button onClick={() => toggleDomain(d.name)} className="flex min-w-0 flex-1 items-center gap-3.5 text-left">
                  <ChevronRight className={`h-[15px] w-[15px] shrink-0 text-slate-500 transition-transform ${open ? 'rotate-90' : ''}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[14.5px] font-bold">{d.name}</div>
                    <div className="mt-0.5 text-[11.5px] text-slate-400">{filtersActive ? `${d.items.length} of ${d.all.length}` : d.all.length} {noun.many}</div>
                  </div>
                </button>
                {/* Per-audit CLOSURE (each group is its own audit — no blended
                    compliance %). Closed-rate + open / overdue for this audit. */}
                {(() => {
                  const roll = computeRollup(d.all as SlaItemInput[], Date.now(), pol.due_soon_days, pol);
                  const score = averageScore(d.all as SlaItemInput[], Date.now(), pol.due_soon_days, pol) ?? 0;
                  return (
                    <div className="hidden w-[210px] flex-col gap-1 sm:flex" title="Audit score = average of its points' own date-vs-status scores">
                      <div className="flex items-center gap-2.5">
                        <div className="h-[7px] flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${score}%`, backgroundColor: scoreColor(score) }} /></div>
                        <span className="w-[56px] shrink-0 text-right text-[11.5px] font-bold text-slate-700">{score}% score</span>
                      </div>
                      <div className="flex items-center justify-end gap-2.5 text-[10.5px]">
                        <span className="text-slate-500">{roll.open} open</span>
                        {roll.overdue > 0 && <span className="font-semibold text-rose-600">{roll.overdue} overdue</span>}
                      </div>
                    </div>
                  );
                })()}
                <button onClick={() => setAddDomain(d.name)} title={`Add a ${noun.one} to "${d.name}"`} className="inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-lg border border-[#9fe7d8] bg-[#e7faf5] px-2.5 text-[12px] font-semibold text-[#0f766e] hover:bg-[#d3f5ec]">
                  <Plus className="h-[13px] w-[13px]" /> Add item
                </button>
              </div>

              {open && (
                <div className="overflow-x-auto border-t border-slate-100">
                  <table className="w-full table-fixed border-collapse">
                    <colgroup><col style={{ width: 36 }} /><col style={{ width: 58 }} /><col /><col className="hidden lg:table-column" style={{ width: 132 }} /><col className="hidden lg:table-column" style={{ width: 100 }} /><col style={{ width: 130 }} /><col className="hidden md:table-column" style={{ width: 96 }} /><col style={{ width: 64 }} /><col style={{ width: 78 }} /></colgroup>
                    <thead>
                      <tr className="border-b border-[#9fe7d8] bg-[#e7faf5] text-left text-[10px] font-semibold uppercase tracking-wide text-[#0f766e]">
                        <th className="px-2 py-2" /><th className="px-2 py-2">#</th><th className="px-2 py-2">{noun.One}</th>
                        <th className="hidden px-2 py-2 lg:table-cell">Responsible</th><th className="hidden px-2 py-2 lg:table-cell">Timeline</th>
                        <th className="px-2 py-2">Status</th><th className="hidden px-2 py-2 md:table-cell">Priority</th>
                        <th className="px-2 py-2">Score</th>
                        <th className="px-3 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.items.map((c) => {
                        const evCount = c.evidence_count ?? 0;
                        const spine = { complied: 'border-emerald-500', partially_complied: 'border-amber-500', not_complied: 'border-rose-500', in_progress: 'border-blue-500', na: 'border-gray-400' }[c.compliance_status] ?? 'border-gray-400';
                        return (
                          <tr key={c.id} onClick={() => setModalItem(c)} className="cursor-pointer align-top hover:bg-[#fbfcfe]" style={{ borderBottom: '1px solid #f4f6f9' }}>
                            <td className={`border-l-[3px] ${spine} px-2 py-3 text-center align-top`}><ChevronRight className="inline h-[15px] w-[15px] text-slate-400" /></td>
                            <td className="px-2 py-3 align-top font-mono text-[11.5px] font-medium text-slate-400">{c.item_number}</td>
                            <td className="px-2 py-3 align-top"><p className="text-[13px] leading-snug text-slate-800 line-clamp-2">{c.control_description}</p></td>
                            <td className="hidden truncate px-2 py-3 align-top text-[12px] text-slate-600 lg:table-cell">{c.responsible_party ?? '—'}</td>
                            <td className="hidden px-2 py-3 align-top text-[12px] text-slate-600 lg:table-cell">{c.timeline ?? '—'}</td>
                            <td className="px-2 py-3 align-top"><StatusBadge status={c.compliance_status} /></td>
                            <td className="hidden px-2 py-3 align-top md:table-cell"><PriorityBadge priority={c.priority} /></td>
                            <td className="px-2 py-3 align-top">
                              {(() => { const sc = pointScore(c as SlaItemInput, Date.now(), pol.due_soon_days, pol); return (
                                <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-bold" style={{ backgroundColor: `${scoreColor(sc)}1f`, color: scoreColor(sc) }} title="This point's own score (date vs status)">{sc}%</span>
                              ); })()}
                            </td>
                            <td className="px-3 py-2.5 align-top">
                              <div className="flex items-center justify-end gap-1">
                                <button onClick={(e) => { e.stopPropagation(); setModalItem(c); }} title="View details"
                                  className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-[#0f766e]"><Eye className="h-[15px] w-[15px]" /></button>
                                <button onClick={(e) => { e.stopPropagation(); setPanel({ item: c, tab: 'evidence' }); }} title="Evidence"
                                  className="relative flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-[#e7faf5] hover:text-[#0f766e]">
                                  <Paperclip className="h-[15px] w-[15px]" />
                                  {evCount > 0 && <span className="absolute -right-1 -top-1 flex h-[15px] min-w-[15px] items-center justify-center rounded-full px-[3px] text-[9px] font-bold text-white" style={{ background: '#0f766e' }}>{evCount}</span>}
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); setPanel({ item: c, tab: 'ai' }); }} title="AI suggest evidence"
                                  className="flex h-7 w-7 items-center justify-center rounded-md text-purple-600 hover:bg-purple-50"><Sparkles className="h-[15px] w-[15px]" /></button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {d.items.length === 0 && (
                        <tr><td colSpan={9} className="px-4 py-6 text-center text-sm text-slate-400">No {noun.many} match the filters.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
        {visibleDomains.length === 0 && (
          <div className="rounded-[14px] border-[1.5px] border-dashed border-slate-300 bg-white px-6 py-12 text-center">
            <div className="text-[14px] font-semibold text-slate-700">No {noun.many} match your filters</div>
            <button onClick={clearFilters} className="mt-2 text-[12.5px] font-semibold" style={{ color: '#0f766e' }}>Clear filters</button>
          </div>
        )}
      </div>

      {modalItem && (
        <ControlModal
          assessmentId={assessment.id}
          item={modalItem}
          api={api}
          noun={noun}
          onClose={() => setModalItem(null)}
          onEvidence={() => { setPanel({ item: modalItem, tab: 'evidence' }); setModalItem(null); }}
          onAi={() => { setPanel({ item: modalItem, tab: 'ai' }); setModalItem(null); }}
        />
      )}
      {panel && <SidePanel assessmentId={assessment.id} item={panel.item} tab={panel.tab} api={api} onTab={(t) => setPanel({ ...panel, tab: t })} onClose={() => setPanel(null)} />}
      {addDomain !== null && (
        <AddControlDrawer
          assessmentId={assessment.id}
          domains={[...new Set(controls.map((c) => c.area_domain))]}
          domainFields={domainFields}
          lockedDomain={addDomain}
          api={api}
          onClose={() => setAddDomain(null)}
        />
      )}
    </div>
  );
}

function DetailKpi({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] text-slate-400">{label}</div>
      <div className="text-[23px] font-bold tracking-tight" style={color ? { color } : undefined}>{value}</div>
    </div>
  );
}
function ChipGroup({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="mr-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      {options.map(([val, lbl]) => {
        const active = value === val;
        return (
          <button key={val} onClick={() => onChange(val)}
            className={`rounded-lg border px-2.5 py-[5px] text-[12px] font-semibold ${active ? '' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`}
            style={active ? { background: '#e7faf5', color: '#0f766e', borderColor: '#9fe7d8' } : undefined}>{lbl}</button>
        );
      })}
    </div>
  );
}

/* Centered popup dialog wrapping the EDITABLE record (opened by the row eye icon). */
function ControlModal({ assessmentId, item, api, onClose, onEvidence, onAi }: { assessmentId: number | string; item: ControlItem; api?: DetailApi; onClose: () => void; onEvidence: () => void; onAi: () => void }) {
  const accent = ({ complied: '#10b981', partially_complied: '#f59e0b', not_complied: '#f43f5e', in_progress: '#3b82f6', na: '#9ca3af' } as Record<ComplianceStatus, string>)[item.compliance_status];
  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: 'rgba(15,23,42,0.45)' }}>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[88vh] w-[720px] max-w-[96vw] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_-20px_rgba(15,23,42,0.4)]" style={{ borderLeft: `4px solid ${accent}` }}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <div className="text-[13px] font-semibold text-slate-500">Control detail · edit</div>
          <button onClick={onClose} className="flex h-[30px] w-[30px] items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-900"><X className="h-[17px] w-[17px]" /></button>
        </div>
        <ControlRecord assessmentId={assessmentId} item={item} api={api} onEvidence={onEvidence} onAi={onAi} onClose={onClose} />
      </div>
    </div>
  );
}

/* Editable control record — sectioned card layout, saves via PUT /items/{id}. */
function ControlRecord({ assessmentId, item, api, onEvidence, onAi, onClose }: {
  assessmentId: number | string; item: ControlItem; api?: DetailApi;
  onEvidence: () => void; onAi: () => void; onClose?: () => void;
}) {
  const evCount = item.evidence_count ?? 0;
  const users = api?.tenantUsers ?? [];
  const orig = {
    control_description: item.control_description ?? '',
    compliance_status: (item.compliance_status ?? 'in_progress') as string,
    priority: (item.priority ?? '') as string,
    area_domain: item.area_domain ?? '',
    responsible_party: item.responsible_party ?? '',
    timeline: item.timeline ?? '',
    risk_rating: (item.risk_rating ?? '') as string,
    maturity_score: item.maturity_score == null ? '' : String(item.maturity_score),
    remediation_status: (item.remediation_status ?? '') as string,
    gaps_identified: item.gaps_identified ?? '',
    proposed_solution: item.proposed_solution ?? '',
    evidence_reference: item.evidence_reference ?? '',
    remarks: item.remarks ?? '',
  };
  const [f, setF] = useState(orig);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof orig, v: string) => setF((s) => ({ ...s, [k]: v }));
  const dirty = (Object.keys(orig) as (keyof typeof orig)[]).some((k) => f[k] !== orig[k]);

  const save = async () => {
    if (!api) return;
    const patch: Record<string, string | number> = {};
    (Object.keys(orig) as (keyof typeof orig)[]).forEach((k) => {
      if (f[k] === orig[k]) return;
      if (k === 'maturity_score') { patch.maturity_score = f.maturity_score === '' ? -1 : Number(f.maturity_score); return; }
      patch[k] = f[k];
    });
    if (Object.keys(patch).length === 0) { onClose?.(); return; }
    setSaving(true);
    try { await api.updateControl(assessmentId, item.id, patch); onClose?.(); }
    catch { alert('Failed to save changes.'); }
    finally { setSaving(false); }
  };

  const inp = 'w-full rounded-[8px] border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] text-slate-800 outline-none focus:border-[#7fdcc9]';
  const lbl = 'mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400';
  const Tile = ({ label, children }: { label: string; children: ReactNode }) => (
    <div className="rounded-[10px] border border-slate-200 bg-white px-3 py-2.5">
      <div className={lbl}>{label}</div>
      {children}
    </div>
  );

  return (
    <>
      <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto overflow-x-hidden px-5 py-4">
        {/* header band */}
        <div className="flex items-start justify-between gap-4 rounded-[12px] border border-slate-200 bg-white px-[18px] py-4">
          <div className="min-w-0 flex-1">
            <div className="mb-2.5 flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-[#9fe7d8] bg-[#e7faf5] px-2 py-0.5 font-mono text-[12px] font-semibold text-[#0f766e]">{item.item_number}</span>
              <StatusBadge status={f.compliance_status as ComplianceStatus} />
              <PriorityBadge priority={(f.priority || null) as Priority | null} />
            </div>
            <div className={lbl}>Control / Audit Point</div>
            <textarea value={f.control_description} onChange={(e) => set('control_description', e.target.value)} className={`${inp} min-h-[70px] resize-y leading-relaxed`} />
          </div>
          <div className="flex shrink-0 gap-2">
            <button onClick={onEvidence} className="inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[12.5px] font-semibold text-slate-600 hover:bg-slate-100">
              <Paperclip className="h-[14px] w-[14px]" /> Evidence <span className="rounded-[5px] px-1.5 py-px text-[11px] font-bold" style={{ background: '#e7faf5', color: '#0f766e' }}>{evCount}</span>
            </button>
            <button onClick={onAi} className="inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50 px-3 text-[12.5px] font-semibold text-purple-700 hover:bg-purple-100">
              <Sparkles className="h-[14px] w-[14px]" /> AI assist
            </button>
          </div>
        </div>

        {/* classification */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <Tile label="Compliance Status">
            <select value={f.compliance_status} onChange={(e) => set('compliance_status', e.target.value)} className={inp}>
              <option value="complied">Complied</option><option value="partially_complied">Partial</option>
              <option value="not_complied">Not Complied</option><option value="in_progress">In Progress</option><option value="na">N/A</option>
            </select>
          </Tile>
          <Tile label="Priority">
            <select value={f.priority} onChange={(e) => set('priority', e.target.value)} className={inp}>
              <option value="">—</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
            </select>
          </Tile>
          <Tile label="Area / Domain"><input value={f.area_domain} onChange={(e) => set('area_domain', e.target.value)} className={inp} /></Tile>
        </div>

        {/* ownership & assessment */}
        <div>
          <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-400">Ownership &amp; Assessment</div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            <Tile label="Responsible">
              <select value={f.responsible_party} onChange={(e) => set('responsible_party', e.target.value)} className={inp}>
                <option value="">Unassigned</option>
                {!!f.responsible_party && !users.some((u) => u.label === f.responsible_party) && <option value={f.responsible_party}>{f.responsible_party}</option>}
                {users.map((u) => <option key={u.id} value={u.label}>{u.label}</option>)}
              </select>
            </Tile>
            <Tile label="Timeline"><input value={f.timeline} onChange={(e) => set('timeline', e.target.value)} placeholder="e.g. Q3-2025" className={inp} /></Tile>
            <Tile label="Risk Rating">
              <select value={f.risk_rating} onChange={(e) => set('risk_rating', e.target.value)} className={inp}>
                <option value="">—</option><option value="High">High</option><option value="Medium">Medium</option><option value="Low">Low</option>
              </select>
            </Tile>
            <Tile label="Maturity">
              <select value={f.maturity_score} onChange={(e) => set('maturity_score', e.target.value)} className={inp}>
                <option value="">—</option>{[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={String(n)}>{n}/5</option>)}
              </select>
            </Tile>
            <Tile label="Remediation">
              <select value={f.remediation_status} onChange={(e) => set('remediation_status', e.target.value)} className={inp}>
                <option value="">—</option><option value="Open">Open</option><option value="In Progress">In Progress</option><option value="Closed">Closed</option>
              </select>
            </Tile>
          </div>
        </div>

        {/* findings & remediation */}
        <div>
          <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-400">Findings &amp; Remediation</div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="rounded-[11px] border border-rose-200 bg-white p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-[7px] bg-rose-50"><AlertTriangle className="h-[13px] w-[13px] text-rose-600" /></span>
                <span className="text-[11px] font-bold uppercase tracking-wide text-rose-700">Gaps Identified</span>
              </div>
              <textarea value={f.gaps_identified} onChange={(e) => set('gaps_identified', e.target.value)} placeholder="Describe the gaps observed…" className={`${inp} min-h-[64px] resize-y leading-relaxed`} />
            </div>
            <div className="rounded-[11px] border border-emerald-200 bg-white p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-[7px] bg-emerald-50"><Sparkles className="h-[13px] w-[13px] text-emerald-600" /></span>
                <span className="text-[11px] font-bold uppercase tracking-wide text-emerald-700">Proposed Solution</span>
              </div>
              <textarea value={f.proposed_solution} onChange={(e) => set('proposed_solution', e.target.value)} placeholder="Suggest remediation steps…" className={`${inp} min-h-[64px] resize-y leading-relaxed`} />
            </div>
          </div>
        </div>

        {/* meta */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <Tile label="Evidence Reference"><input value={f.evidence_reference} onChange={(e) => set('evidence_reference', e.target.value)} className={inp} /></Tile>
          <Tile label="Remarks"><input value={f.remarks} onChange={(e) => set('remarks', e.target.value)} className={inp} /></Tile>
        </div>
      </div>

      {/* footer save bar */}
      <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-[#fbfcfe] px-5 py-3">
        <span className="text-[12px] text-slate-400">{dirty ? 'Unsaved changes' : 'No changes'}</span>
        <div className="flex gap-2.5">
          <button onClick={onClose} className="inline-flex h-[36px] items-center rounded-[9px] border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={saving || !dirty} className="inline-flex h-[36px] items-center gap-1.5 rounded-[9px] px-4 text-[13px] font-semibold disabled:opacity-50" style={{ background: TEAL, color: ON_TEAL }}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-[14px] w-[14px]" />} Save changes
          </button>
        </div>
      </div>
    </>
  );
}
function Row({ label, children, wrap, last, labelClass }: { label: string; children: React.ReactNode; wrap?: boolean; last?: boolean; labelClass?: string }) {
  return (
    <tr className={`align-top ${last ? '' : 'border-b border-slate-100'}`}>
      <th className={`px-4 py-2.5 text-left align-top text-[11px] font-semibold ${labelClass ?? 'bg-slate-50 text-slate-500'}`}>{label}</th>
      <td className={`px-4 py-2.5 text-[13px] leading-relaxed ${wrap ? 'whitespace-pre-line' : ''}`}>{children}</td>
    </tr>
  );
}

/* ---------------- Side panel (wired to real evidence + AI) ---------------- */
function parseAiRecJson(s: string | null | undefined): AiRec | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    if (v && Array.isArray(v.recommendations)) return v as AiRec;
    return null;
  } catch { return null; }
}

function PanelField({ label, children, tint }: { label: string; children: ReactNode; tint?: 'rose' | 'green' }) {
  const bg = tint === 'rose' ? 'bg-[#fef6f6]' : tint === 'green' ? 'bg-[#f0fbf6]' : '';
  const lc = tint === 'rose' ? 'text-rose-700' : tint === 'green' ? 'text-emerald-700' : 'text-slate-400';
  return (
    <div className={`border-b border-slate-100 px-3.5 py-3 ${bg}`}>
      <div className={`mb-1 text-[10.5px] font-semibold uppercase tracking-wide ${lc}`}>{label}</div>
      <div className="text-[13px] leading-relaxed text-slate-700">{children}</div>
    </div>
  );
}

function SidePanel({
  assessmentId, item, tab, onTab, onClose, api,
}: {
  assessmentId: number | string; item: ControlItem; tab: 'details' | 'evidence' | 'ai';
  onTab: (t: 'details' | 'evidence' | 'ai') => void; onClose: () => void; api?: DetailApi;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [aiRec, setAiRec] = useState<AiRec | null>(() => parseAiRecJson(item.ai_evidence_recommendation));
  const [generating, setGenerating] = useState(false);

  const { data: evidence = [], isLoading: evLoading, refetch: refetchEvidence } = useQuery<EvidenceRow[]>({
    queryKey: ['panel-evidence', assessmentId, item.id],
    queryFn: () => (api ? api.loadEvidence(assessmentId, item.id) : Promise.resolve([])),
    enabled: !!api && tab === 'evidence',
    staleTime: 15_000,
  });

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !api) return;
    setUploading(true);
    try { await api.uploadEvidence(assessmentId, item.id, file); await refetchEvidence(); }
    catch { alert('Upload failed.'); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const regenerate = async () => {
    if (!api) return;
    setGenerating(true);
    try { const rec = await api.generateAi(assessmentId, item.id); setAiRec(rec); }
    catch { alert('Failed to generate AI suggestions.'); }
    finally { setGenerating(false); }
  };

  const evTone = (tone?: string): [string, string] =>
    tone === 'teal' ? ['#e7faf5', '#0f766e'] : tone === 'rose' ? ['#fef2f2', '#9f1239'] : ['#f1f5f9', '#475569'];

  return (
    <>
      <input ref={fileRef} type="file" accept=".pdf,.xlsx,.xls,.png,.jpg,.jpeg,.csv,.docx" className="hidden" onChange={onFile} />
      <div onClick={onClose} className="fixed inset-0 z-40" style={{ background: 'rgba(15,23,42,0.32)' }} />
      <div className="fixed right-0 top-0 z-50 flex h-screen w-[440px] max-w-[92vw] flex-col bg-white shadow-[-12px_0_40px_-16px_rgba(15,23,42,0.3)]">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-[22px] py-[18px]">
          <div className="min-w-0">
            <div className="mb-1 font-mono text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#0f766e' }}>{item.item_number}</div>
            <div className="text-[14.5px] font-bold leading-snug">{item.control_description}</div>
          </div>
          <button onClick={onClose} className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-900"><X className="h-[17px] w-[17px]" /></button>
        </div>
        <div className="flex gap-0.5 border-b border-slate-100 px-[22px]">
          {(['details', 'evidence', 'ai'] as const).map((t) => (
            <button key={t} onClick={() => onTab(t)} className="mr-[18px] border-b-2 py-3 text-[13px] font-semibold"
              style={tab === t ? { color: '#0f766e', borderColor: TEAL } : { color: '#64748b', borderColor: 'transparent' }}>
              {t === 'details' ? 'Details' : t === 'evidence' ? 'Evidence' : 'AI Suggestions'}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto px-[22px] py-5">
          {tab === 'details' ? (
            <div className="overflow-hidden rounded-[10px] border border-slate-200">
              <PanelField label="Control / Audit Point">{item.control_description}</PanelField>
              <div className="flex gap-2.5 border-b border-slate-100 px-3.5 py-3">
                <div className="flex-1"><div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Compliance Status</div><StatusBadge status={item.compliance_status} /></div>
                <div className="flex-1"><div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Priority</div><PriorityBadge priority={item.priority} /></div>
              </div>
              <PanelField label="Area / Domain">{item.area_domain}</PanelField>
              <div className="flex gap-2.5 border-b border-slate-100 px-3.5 py-3">
                <div className="flex-1"><div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Responsible Party</div><div className="text-[13px] text-slate-700">{item.responsible_party ?? '—'}</div></div>
                <div className="flex-1"><div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Timeline</div><div className="text-[13px] text-slate-700">{item.timeline ?? '—'}</div></div>
              </div>
              <div className="flex gap-2.5 border-b border-slate-100 px-3.5 py-3">
                <div className="flex-1"><div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Risk Rating</div><div className="text-[13px] font-semibold" style={{ color: riskColor(item.risk_rating) }}>{item.risk_rating ?? '—'}</div></div>
                <div className="flex-1"><div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Maturity</div><div className="flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${((item.maturity_score ?? 0) / 5) * 100}%`, background: TEAL }} /></div><span className="text-[12px] font-bold text-slate-700">{item.maturity_score ?? 0}/5</span></div></div>
              </div>
              <div className="border-b border-slate-100 px-3.5 py-3"><div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Remediation Status</div><span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${item.remediation_status === 'Closed' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : item.remediation_status === 'Open' ? 'bg-rose-100 text-rose-800 border-rose-200' : 'bg-blue-100 text-blue-800 border-blue-200'}`}>{item.remediation_status ?? '—'}</span></div>
              <PanelField label="Gaps Identified" tint="rose">{item.gaps_identified ?? 'No gaps recorded'}</PanelField>
              <PanelField label="Proposed Solution" tint="green">{item.proposed_solution ?? 'No proposed solution'}</PanelField>
              <PanelField label="Evidence Reference"><span className="font-medium" style={{ color: '#0f766e' }}>{item.evidence_reference ?? '—'}</span></PanelField>
              <div className="px-3.5 py-3"><div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Remarks</div><div className="text-[13px] italic text-slate-500">{item.remarks ?? '—'}</div></div>
            </div>
          ) : tab === 'evidence' ? (
            <div className="flex flex-col gap-3">
              <div onClick={() => fileRef.current?.click()} className="cursor-pointer rounded-[11px] border-[1.5px] border-dashed border-slate-300 p-[18px] text-center hover:border-[#7fdcc9] hover:bg-[#fbfcfe]">
                {uploading ? <Loader2 className="mx-auto mb-1.5 h-[22px] w-[22px] animate-spin" style={{ color: '#0f766e' }} /> : <Upload className="mx-auto mb-1.5 h-[22px] w-[22px]" style={{ color: '#0f766e' }} />}
                <div className="text-[13px] font-semibold text-slate-700">{uploading ? 'Uploading…' : 'Drop files or click to upload'}</div>
                <div className="mt-0.5 text-[11.5px] text-slate-400">PDF, XLSX, PNG · up to 25 MB</div>
              </div>
              {evLoading ? (
                <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
              ) : evidence.length > 0 ? evidence.map((e) => {
                const [bg, fg] = evTone(e.tone);
                return (
                  <div key={e.id} className="flex items-center gap-3 rounded-[10px] border border-slate-200 px-3.5 py-3 hover:border-slate-300">
                    <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg text-[9.5px] font-bold" style={{ background: bg, color: fg }}>{e.ext}</div>
                    <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-semibold">{e.name}</div><div className="mt-0.5 text-[11px] text-slate-400">{e.meta}</div></div>
                    <Download className="h-4 w-4 text-slate-300" />
                  </div>
                );
              }) : <div className="py-6 text-center text-[12.5px] text-slate-400">No evidence linked to this control yet.</div>}
            </div>
          ) : (
            <div className="flex flex-col gap-3.5">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-purple-700"><Sparkles className="h-[15px] w-[15px]" /> Recommended evidence to gather</div>
              {aiRec ? (
                <>
                  {aiRec.summary && (
                    <div className="rounded-[11px] border border-purple-200 bg-purple-50 px-4 py-3">
                      <div className="text-[12.5px] leading-relaxed text-slate-700">{aiRec.summary}</div>
                    </div>
                  )}
                  <div className="flex flex-col gap-2">
                    {aiRec.recommendations.map((r, i) => (
                      <div key={i} className="rounded-[10px] border border-slate-200 px-3.5 py-3">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-800"><FileText className="h-3.5 w-3.5" style={{ color: '#9333ea' }} />{r.evidence_type}</span>
                          <span className="rounded-full border px-2 py-0.5 text-[10px] font-semibold" style={{ background: '#faf5ff', color: '#7e22ce', borderColor: '#e9d5ff' }}>{r.priority}</span>
                        </div>
                        <div className="text-[12px] leading-relaxed text-slate-600">{r.description}</div>
                        {r.example_files && r.example_files.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {r.example_files.map((ex, j) => (
                              <span key={j} className="inline-flex items-center gap-1 rounded-[6px] border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10.5px] font-medium text-slate-500"><Paperclip className="h-2.5 w-2.5" />{ex}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2.5">
                    <button onClick={() => onTab('evidence')} className="inline-flex h-[38px] flex-1 items-center justify-center gap-1.5 rounded-[9px] text-[13px] font-semibold" style={{ background: TEAL, color: ON_TEAL }}><Paperclip className="h-[14px] w-[14px]" /> Attach evidence</button>
                    <button onClick={regenerate} disabled={generating} className="inline-flex h-[38px] items-center justify-center gap-1.5 rounded-[9px] border border-slate-200 bg-white px-3.5 text-[13px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60">{generating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Regenerate'}</button>
                  </div>
                </>
              ) : (
                <div className="rounded-[11px] border border-purple-200 bg-purple-50 px-4 py-5 text-center">
                  <div className="mb-3 text-[12.5px] text-slate-600">No recommendations yet. Generate the evidence the AI suggests for this control.</div>
                  <button onClick={regenerate} disabled={generating} className="inline-flex h-[38px] items-center justify-center gap-1.5 rounded-[9px] px-4 text-[13px] font-semibold disabled:opacity-60" style={{ background: '#9333ea', color: '#fff' }}>
                    {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-[15px] w-[15px]" />} Recommend evidence
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ---------------- Add control drawer (design-styled) ---------------- */
function AddControlDrawer({
  assessmentId, domains, domainFields, lockedDomain, api, onClose,
}: {
  assessmentId: number | string; domains: string[]; domainFields?: Record<string, Set<string>>; lockedDomain?: string; api?: DetailApi; onClose: () => void;
}) {
  const [form, setForm] = useState<NewControl>({
    item_number: '', area_domain: lockedDomain ?? domains[0] ?? '', control_description: '',
    compliance_status: 'in_progress', priority: 'medium', responsible_party: '', timeline: '',
    gaps_identified: '', proposed_solution: '', remarks: '',
  });
  // When opened from a domain header the domain is fixed; otherwise the user picks.
  const [newDomain, setNewDomain] = useState(!lockedDomain && domains.length === 0);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof NewControl, v: string) => setForm((s) => ({ ...s, [k]: v }));

  // Show a field only if the selected domain actually uses it (a new domain, or
  // a domain with no recorded usage, shows all fields).
  const usage = !newDomain ? domainFields?.[form.area_domain] : undefined;
  const showField = (f: string) => newDomain || !usage || usage.size === 0 || usage.has(f);

  const save = async () => {
    if (!api || !form.control_description.trim()) return;
    setSaving(true);
    try { await api.createControl(assessmentId, form); onClose(); }
    catch { alert('Failed to add control.'); }
    finally { setSaving(false); }
  };

  const inputCls = 'w-full rounded-[9px] border border-slate-200 bg-white px-3 py-2 text-[13px] outline-none focus:border-[#7fdcc9]';
  const labelCls = 'mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400';

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-40" style={{ background: 'rgba(15,23,42,0.32)' }} />
      <div className="fixed right-0 top-0 z-50 flex h-screen w-[460px] max-w-[94vw] flex-col bg-white shadow-[-12px_0_40px_-16px_rgba(15,23,42,0.3)]">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-[22px] py-[18px]">
          <div className="min-w-0">
            <div className="text-[15.5px] font-bold tracking-tight">Add item</div>
            {lockedDomain && <div className="mt-0.5 truncate text-[11.5px] text-slate-400">to <span className="font-semibold" style={{ color: '#0f766e' }}>{lockedDomain}</span></div>}
          </div>
          <button onClick={onClose} className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-900"><X className="h-[17px] w-[17px]" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-[22px] py-5">
          <div className="flex flex-col gap-3.5">
            <div>
              <label className={labelCls}>Area / Domain</label>
              {lockedDomain ? (
                <div className="rounded-[9px] border border-[#9fe7d8] bg-[#e7faf5] px-3 py-2 text-[13px] font-semibold text-[#0f766e]">{lockedDomain}</div>
              ) : newDomain ? (
                <input className={inputCls} placeholder="New domain name" value={form.area_domain} onChange={(e) => set('area_domain', e.target.value)} />
              ) : (
                <select className={inputCls} value={form.area_domain} onChange={(e) => set('area_domain', e.target.value)}>
                  {domains.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              )}
              {!lockedDomain && domains.length > 0 && (
                <button onClick={() => setNewDomain((v) => !v)} className="mt-1 text-[11.5px] font-semibold" style={{ color: '#0f766e' }}>
                  {newDomain ? 'Choose existing domain' : '+ New domain'}
                </button>
              )}
            </div>
            <div>
              <label className={labelCls}>Control # (optional)</label>
              <input className={inputCls} value={form.item_number} onChange={(e) => set('item_number', e.target.value)} placeholder="e.g. 12" />
            </div>
            <div>
              <label className={labelCls}>Control / Audit point</label>
              <textarea className={`${inputCls} min-h-[80px] resize-y`} value={form.control_description} onChange={(e) => set('control_description', e.target.value)} placeholder="Describe the control…" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Status</label>
                <select className={inputCls} value={form.compliance_status} onChange={(e) => set('compliance_status', e.target.value)}>
                  <option value="complied">Complied</option><option value="partially_complied">Partial</option>
                  <option value="not_complied">Not Complied</option><option value="in_progress">In Progress</option><option value="na">N/A</option>
                </select>
              </div>
              {showField('priority') && (
                <div>
                  <label className={labelCls}>Priority</label>
                  <select className={inputCls} value={form.priority} onChange={(e) => set('priority', e.target.value)}>
                    <option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                  </select>
                </div>
              )}
            </div>
            {(showField('responsible_party') || showField('timeline')) && (
              <div className="grid grid-cols-2 gap-3">
                {showField('responsible_party') && <div><label className={labelCls}>Responsible</label><input className={inputCls} value={form.responsible_party} onChange={(e) => set('responsible_party', e.target.value)} /></div>}
                {showField('timeline') && <div><label className={labelCls}>Timeline</label><input className={inputCls} value={form.timeline} onChange={(e) => set('timeline', e.target.value)} placeholder="e.g. Q3-2025" /></div>}
              </div>
            )}
            {showField('gaps_identified') && <div><label className={labelCls}>Gaps identified</label><textarea className={`${inputCls} min-h-[60px] resize-y`} value={form.gaps_identified} onChange={(e) => set('gaps_identified', e.target.value)} /></div>}
            {showField('proposed_solution') && <div><label className={labelCls}>Proposed solution</label><textarea className={`${inputCls} min-h-[60px] resize-y`} value={form.proposed_solution} onChange={(e) => set('proposed_solution', e.target.value)} /></div>}
            {showField('remarks') && <div><label className={labelCls}>Remarks</label><textarea className={`${inputCls} min-h-[50px] resize-y`} value={form.remarks} onChange={(e) => set('remarks', e.target.value)} /></div>}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2.5 border-t border-slate-100 px-[22px] py-4">
          <button onClick={onClose} className="inline-flex h-[38px] items-center rounded-[9px] border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={saving || !form.control_description.trim()} className="inline-flex h-[38px] items-center gap-1.5 rounded-[9px] px-4 text-[13px] font-semibold disabled:opacity-60" style={{ background: TEAL, color: ON_TEAL }}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-[14px] w-[14px]" />} Add item
          </button>
        </div>
      </div>
    </>
  );
}
