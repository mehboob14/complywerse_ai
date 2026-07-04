'use client';

/**
 * Assessments — board overview. Graphical, board-first (in the spirit of the
 * ERM / Compliance module dashboards): a module performance hero, an SLA closure
 * hero (SLA is the priority here), an attention list, then the assessments
 * grouped BY CATEGORY as scored cards. Every card carries a content score AND a
 * universal SLA score; clicking opens the formula popup. Data: one call to
 * GET /compliance/assessments/overview (all scoring server-side).
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import {
  AlertTriangle, Clock, X, ArrowRight, Layers,
} from 'lucide-react';
import { scoreBand, ScoreRing, MetricRow, type OverviewMetric } from '@/components/dashboard/score-kit';
import { SlaClosurePanel, type SlaContext } from './SlaClosurePanel';
import { computeRollup, fmtDate, type SlaItemInput, type SlaPolicy } from './slaEngine';
import type { SlaPoint } from './types';

type Assess = {
  id: number; name: string; format: string; family: string; item_noun: string;
  status: string; content: number | null; sla: number | null; level_achieved?: number | null;
  metrics: OverviewMetric[]; sla_metrics: OverviewMetric[];
  counts: Record<string, unknown>; sla_counts: Record<string, number>;
  by_dimension?: Record<string, number> | null;
  by_domain?: Record<string, { pct?: number | null } | number> | null;
  by_platform?: Record<string, { pct?: number | null }> | null;
};
type Cat = { category: string; score: number | null; sla: number | null; count: number; assessments: Assess[] };
type Payload = {
  as_of: string;
  performance: { score: number | null; grade: string | null; assessments: number };
  sla: { score: number | null; gaps: number; closed: number; open: number; overdue: number };
  attention: { overdue_gaps: number; open_gaps: number; not_started: number };
  categories: Cat[];
};

const FAMILY_LABEL: Record<string, string> = {
  asvs: 'Verification', checklist: 'Checklist', maturity: 'Maturity', risk: 'Risk register', tracking: 'Tracking',
};

function pct(n: number | null | undefined) {
  return n == null ? '—' : Math.round(n);
}

// ---- assessment card (compact) ----
function AssessCard({ a, category, catColor, onOpen }: { a: Assess; category?: string; catColor?: string; onOpen: () => void }) {
  const band = scoreBand(a.content);
  const sband = scoreBand(a.sla);
  const topMetrics = a.metrics.filter((m) => m.score != null).slice(0, 3);
  return (
    <button type="button" onClick={onOpen}
      className="group flex flex-col rounded-xl border border-slate-200 bg-white p-3 text-left transition-all hover:border-slate-300 hover:shadow-md"
      style={{ borderLeft: `3px solid ${band.hex}` }}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="truncate text-[12px] font-semibold leading-tight text-slate-800">{a.name}</h4>
          <p className="mt-0.5 flex items-center gap-1 text-[9px] uppercase tracking-wide text-slate-400">
            {category && (
              <>
                <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ backgroundColor: catColor }} />
                <span className="truncate">{category}</span>
                <span className="text-slate-300">·</span>
              </>
            )}
            <span className="flex-shrink-0">{FAMILY_LABEL[a.family] ?? a.family}</span>
          </p>
        </div>
        <span className="text-lg font-bold leading-none" style={{ color: band.hex }}>{pct(a.content)}</span>
      </div>
      <div className="mt-auto space-y-1">
        {topMetrics.map((m) => {
          const mb = scoreBand(m.score);
          return (
            <div key={m.key} className="flex items-center gap-1.5">
              <span className="w-[68px] flex-shrink-0 truncate text-[9px] text-slate-500">{m.label}</span>
              <span className="relative h-1 flex-1 rounded-full bg-slate-100">
                <span className="block h-1 rounded-full" style={{ width: `${Math.max(0, Math.min(100, m.score ?? 0))}%`, backgroundColor: mb.hex }} />
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-1.5">
        <span className="inline-flex items-center gap-1 text-[9.5px] text-slate-500">
          <Clock className="h-2.5 w-2.5" style={{ color: sband.hex }} /> SLA <b style={{ color: sband.hex }}>{pct(a.sla)}</b>
        </span>
        {a.family === 'asvs' && (
          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600">
            {a.level_achieved ? `L${a.level_achieved}` : 'L—'}
          </span>
        )}
      </div>
    </button>
  );
}

// ---- detail popup (content + SLA formulas) ----
function DetailModal({ a, onClose, onOpen }: { a: Assess; onClose: () => void; onOpen: () => void }) {
  const band = scoreBand(a.content);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(3px)' }} onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-5">
          <div className="flex items-center gap-3">
            <ScoreRing score={a.content} size={54} />
            <div>
              <h3 className="text-[15px] font-bold text-slate-800">{a.name}</h3>
              <p className="text-[11px] text-slate-400">{FAMILY_LABEL[a.family] ?? a.family} · SLA {pct(a.sla)}
                {a.family === 'asvs' && a.level_achieved != null && ` · ASVS Level ${a.level_achieved ? 'L' + a.level_achieved : 'none'}`}</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-2">
          <p className="px-4 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Content score = {pct(a.content)}</p>
          <div className="divide-y divide-slate-50">{a.metrics.map((m) => <MetricRow key={m.key} metric={m} />)}</div>

          {a.sla_metrics.length > 0 && (
            <>
              <p className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">SLA (timeliness) = {pct(a.sla)}</p>
              <div className="divide-y divide-slate-50">{a.sla_metrics.map((m) => <MetricRow key={m.key} metric={m} />)}</div>
            </>
          )}

          {/* family-specific breakdowns */}
          {a.by_dimension && (
            <div className="px-4 py-3">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">By dimension (maturity)</p>
              {Object.entries(a.by_dimension).map(([k, v]) => (
                <div key={k} className="flex items-center gap-2 py-0.5 text-[12px]"><span className="w-28 text-slate-600">{k}</span><b className="tabular-nums text-slate-800">{v}</b><span className="text-slate-400">/ 5</span></div>
              ))}
            </div>
          )}
          {a.by_platform && (
            <div className="px-4 py-3">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">By platform</p>
              {Object.entries(a.by_platform).map(([k, v]) => (
                <div key={k} className="flex items-center gap-2 py-0.5 text-[12px]"><span className="w-28 text-slate-600">{k}</span><b className="tabular-nums text-slate-800">{pct(v?.pct)}%</b></div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-slate-100 p-4">
          <button onClick={onOpen} style={{ backgroundColor: band.hex }}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90">
            Open assessment <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// per-assessment open/overdue AS OF the scrubber date — "which audits are still
// open until this date". Reacts live to the SlaClosurePanel's as-of/horizon/policy.
function OpenByAssessment({ points, ctx, onOpen }: { points: SlaPoint[]; ctx: SlaContext; onOpen: (id: number) => void }) {
  const groups = new Map<number, { id: number; name: string; items: SlaItemInput[] }>();
  for (const p of points) {
    const k = Number(p.assessment_id);
    if (!groups.has(k)) groups.set(k, { id: k, name: p.assessment_name ?? `Assessment ${k}`, items: [] });
    groups.get(k)!.items.push(p as SlaItemInput);
  }
  const rows = Array.from(groups.values())
    .map((g) => ({ ...g, roll: computeRollup(g.items, ctx.asOfMs, ctx.horizon, ctx.policy) }))
    .sort((a, b) => b.roll.overdue - a.roll.overdue || b.roll.open - a.roll.open);
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Open by assessment · as of {fmtDate(ctx.asOfMs)}</div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {rows.map((r) => (
          <button key={r.id} type="button" onClick={() => onOpen(r.id)}
            className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-left transition-colors hover:bg-slate-50">
            <span className="min-w-0 flex-1 truncate text-[12px] text-slate-700">{r.name}</span>
            {r.roll.overdue > 0 && <span className="flex-shrink-0 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-600">{r.roll.overdue} overdue</span>}
            <span className="flex-shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{r.roll.open} open</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function AssessmentsBoardOverview({ onOpen, slaPoints = [], slaPolicy, onSlaPolicyChange }: {
  onOpen: (id: number) => void;
  slaPoints?: SlaPoint[];
  slaPolicy?: SlaPolicy;
  onSlaPolicyChange?: (p: SlaPolicy) => void;
}) {
  const [open, setOpen] = useState<Assess | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['assessments-board-overview'],
    queryFn: async () => (await apiClient.get('/compliance/assessments/overview')).data as Payload,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-3">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-44 rounded-2xl" />)}</div>
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">{[1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-48 rounded-2xl" />)}</div>
      </div>
    );
  }
  if (!data) return null;

  const perf = data.performance;
  const band = scoreBand(perf.score);

  return (
    <div className="space-y-4">
      {/* Top: module performance + attention */}
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1fr_0.7fr]">
        {/* module performance */}
        <div className="flex items-center gap-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <ScoreRing score={perf.score} size={92} />
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Assessments Score</p>
            {perf.grade && <span className="mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ backgroundColor: `${band.hex}14`, color: band.hex }}>{perf.grade}</span>}
            <p className="mt-1.5 text-[12px] text-slate-500">{perf.assessments} assessments across {data.categories.length} categories</p>
            <p className="text-[11px] text-slate-400">target 85</p>
          </div>
        </div>

        {/* attention */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800"><AlertTriangle className="h-4 w-4 text-amber-500" /> Needs Attention</div>
          <div className="divide-y divide-slate-50">
            {[['Overdue remediations', data.attention.overdue_gaps, '#e11d48'], ['Open gaps', data.attention.open_gaps, '#64748b'], ['Assessments not started', data.attention.not_started, '#94a3b8']].map(([l, v, col]) => (
              <div key={l as string} className="flex items-center justify-between py-2.5 text-[12px] text-slate-600">
                <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: (v as number) > 0 ? (col as string) : '#e2e8f0' }} />{l as string}</span>
                <span className="text-sm font-bold tabular-nums text-slate-900">{v as number}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Dynamic SLA closure — the hero: time-travel as-of any date, tunable
          policy, per-assessment "open as of this date" breakdown. */}
      <SlaClosurePanel
        items={slaPoints}
        policy={slaPolicy}
        onPolicyChange={onSlaPolicyChange}
        title="SLA — Remediation Closure (drag to time-travel)"
        footer={(ctx) => <OpenByAssessment points={slaPoints} ctx={ctx} onOpen={onOpen} />}
      />

      {/* Category summary tiles — the structured category overview */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <Layers className="h-4 w-4 text-slate-400" />
          <h3 className="text-sm font-bold text-slate-800">By category</h3>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {data.categories.map((c) => {
            const cb = scoreBand(c.score);
            return (
              <div key={c.category} className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: cb.hex }} />
                  <span className="truncate text-[11.5px] font-semibold text-slate-600">{c.category}</span>
                </div>
                <div className="mt-1.5 flex items-baseline gap-2">
                  <span className="text-[26px] font-bold leading-none" style={{ color: cb.hex }}>{pct(c.score)}</span>
                  <span className="text-[10.5px] text-slate-400">SLA {pct(c.sla)} · {c.count}</span>
                </div>
                <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-1.5 rounded-full" style={{ width: `${c.score ?? 0}%`, backgroundColor: cb.hex }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Every assessment in one dense, even grid — category shown as a chip on
          each card so nothing is grouped into sparse, empty rows. */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-sm font-bold text-slate-800">All assessments</h3>
          <span className="text-[11px] text-slate-400">{perf.assessments} scored · click any card for its formulas</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {data.categories.flatMap((c) => c.assessments.map((a) => (
            <AssessCard key={a.id} a={a} category={c.category} catColor={scoreBand(c.score).hex} onOpen={() => setOpen(a)} />
          )))}
        </div>
      </div>

      {open && <DetailModal a={open} onClose={() => setOpen(null)} onOpen={() => { const id = open.id; setOpen(null); onOpen(id); }} />}
    </div>
  );
}
