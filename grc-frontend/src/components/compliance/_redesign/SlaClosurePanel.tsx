'use client';

// Dynamic-SLA closure panel — the as-of timeline scrubber + closure KPIs +
// aging bar. Drop-in on the board and on every assessment dashboard. It owns
// the as-of / horizon / policy state locally; pass `onPolicyChange` to persist
// the tier days per tenant. Nothing here aggregates points into a single score
// — it answers "as of this date, what is open / overdue / due soon."

import { useMemo, useState, type ReactNode } from 'react';
import { Clock, SlidersHorizontal, RotateCcw } from 'lucide-react';
import {
  computeRollup, timelineBounds, fmtDate,
  DEFAULT_SLA_POLICY, type SlaPolicy, type SlaItemInput,
} from './slaEngine';

const DAY = 86_400_000;

export interface SlaContext { asOfMs: number; horizon: number; policy: SlaPolicy }

export function SlaClosurePanel({
  items, policy, onPolicyChange, title = 'Closure & SLA', dense = false, footer,
}: {
  items: SlaItemInput[];
  policy?: SlaPolicy;
  onPolicyChange?: (p: SlaPolicy) => void;
  title?: string;
  dense?: boolean;
  /** Extra content that reacts to the same as-of / horizon / policy state. */
  footer?: (ctx: SlaContext) => ReactNode;
}) {
  const [pol, setPol] = useState<SlaPolicy>(policy ?? DEFAULT_SLA_POLICY);
  const [horizon, setHorizon] = useState<number>((policy ?? DEFAULT_SLA_POLICY).due_soon_days);
  const [tuning, setTuning] = useState(false);

  const bounds = useMemo(() => timelineBounds(items, pol), [items, pol]);
  // As-of is stored as an absolute epoch-ms (null = follow "today"). Storing it
  // absolutely — rather than as a day-offset — means it stays anchored to the
  // right instant even when the data (and therefore the bounds) load in later.
  const [asOf, setAsOf] = useState<number | null>(null);
  const clamp = (ms: number) => Math.min(bounds.maxMs, Math.max(bounds.minMs, ms));
  const asOfMs = asOf == null ? clamp(Date.now()) : clamp(asOf);

  const roll = useMemo(() => computeRollup(items, asOfMs, horizon, pol), [items, asOfMs, horizon, pol]);

  const setTier = (k: keyof SlaPolicy, v: number) => {
    const next = { ...pol, [k]: Math.max(1, v) };
    setPol(next);
    if (k === 'due_soon_days') setHorizon(next.due_soon_days);
    onPolicyChange?.(next);
  };
  const setWeight = (k: keyof SlaPolicy, v: number) => {
    const next = { ...pol, [k]: Math.min(100, Math.max(0, Number.isNaN(v) ? 0 : v)) };
    setPol(next);
    onPolicyChange?.(next);
  };

  const kpis: [string, number | string, string, string][] = [
    ['Open', roll.open, '#0f172a', '#f8fafc'],
    ['Overdue', roll.overdue, '#e11d48', '#fff1f2'],
    ['Due soon', roll.dueSoon, '#b45309', '#fffbeb'],
    ['Closed', roll.closed, '#047857', '#ecfdf5'],
    ['Closure', `${roll.closureRate}%`, '#0369a1', '#eff6ff'],
  ];
  const agingSegs: [string, number, string][] = [
    ['Overdue', roll.aging.overdue, '#e11d48'],
    ['≤30d', roll.aging.d30, '#f59e0b'],
    ['≤60d', roll.aging.d60, '#fbbf24'],
    ['≤90d', roll.aging.d90, '#378ADD'],
    ['later', roll.aging.later, '#5DCAA5'],
    ['no date', roll.aging.noDate, '#94a3b8'],
  ];
  const agingSum = Math.max(1, roll.open);

  return (
    <div className="rounded-[14px] border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Clock className="h-4 w-4 text-slate-400" />
        <h3 className="text-[13.5px] font-bold tracking-tight">{title}</h3>
        <span className="text-[11.5px] text-slate-400">as of {fmtDate(asOfMs)}</span>
        <div className="flex-1" />
        <button onClick={() => setAsOf(null)} title="Jump back to today" className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11.5px] font-semibold text-slate-500 hover:bg-slate-50"><RotateCcw className="h-3 w-3" /> Today</button>
        <button onClick={() => setTuning((v) => !v)} className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11.5px] font-semibold ${tuning ? 'border-[#9fe7d8] bg-[#e7faf5] text-[#0f766e]' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}><SlidersHorizontal className="h-3 w-3" /> Tune SLA</button>
      </div>

      {tuning && (
        <div className="mb-3 space-y-2.5 rounded-lg bg-slate-50 p-2.5">
          <div>
            <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">SLA days per tier</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {([['Critical', 'critical_days'], ['High', 'high_days'], ['Medium', 'medium_days'], ['Low', 'low_days'], ['Due-soon', 'due_soon_days']] as [string, keyof SlaPolicy][]).map(([label, key]) => (
                <label key={key} className="flex flex-col gap-1 text-[11px] text-slate-500">
                  <span>{label} (days)</span>
                  <input type="number" min={1} value={pol[key] ?? 0} onChange={(e) => setTier(key, parseInt(e.target.value || '0', 10))} className="w-full rounded-md border border-slate-200 px-2 py-1 text-[12px] text-slate-800 outline-none focus:border-[#9fe7d8]" />
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Point-score weights (0–100)</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
              {([['Closed on-time', 'score_closed_ontime'], ['Closed late', 'score_closed_late'], ['On track', 'score_on_track'], ['Due soon', 'score_due_soon'], ['Overdue', 'score_overdue'], ['No date', 'score_no_date']] as [string, keyof SlaPolicy][]).map(([label, key]) => (
                <label key={key} className="flex flex-col gap-1 text-[11px] text-slate-500">
                  <span>{label}</span>
                  <input type="number" min={0} max={100} value={pol[key] ?? 0} onChange={(e) => setWeight(key, parseInt(e.target.value || '0', 10))} className="w-full rounded-md border border-slate-200 px-2 py-1 text-[12px] text-slate-800 outline-none focus:border-[#9fe7d8]" />
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* As-of scrubber */}
      <div className="mb-3">
        <input type="range" min={bounds.minMs} max={bounds.maxMs} step={DAY} value={asOfMs} onChange={(e) => setAsOf(parseInt(e.target.value, 10))} className="w-full accent-[#0f766e]" />
        <div className="flex justify-between text-[10.5px] text-slate-400">
          <span>{fmtDate(bounds.minMs)}</span>
          <span>drag to time-travel · due-soon {horizon}d</span>
          <span>{fmtDate(bounds.maxMs)}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {[7, 30, 90].map((h) => (
            <button key={h} onClick={() => { setHorizon(h); }} className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${horizon === h ? 'border-[#9fe7d8] bg-[#e7faf5] text-[#0f766e]' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{h}d</button>
          ))}
        </div>
      </div>

      {/* KPI tiles */}
      <div className={`grid gap-2.5 ${dense ? 'grid-cols-5' : 'grid-cols-2 sm:grid-cols-5'}`}>
        {kpis.map(([label, val, color, bg]) => (
          <div key={label} className="rounded-lg border px-3 py-2" style={{ background: bg, borderColor: `${color}22` }}>
            <div className="text-[11px] font-medium text-slate-500">{label}</div>
            <div className="text-[22px] font-bold tabular-nums" style={{ color }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Aging bar */}
      <div className="mt-3">
        <div className="mb-1 text-[11px] text-slate-500">Aging of open points ({roll.open})</div>
        <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100">
          {agingSegs.map(([label, n, c]) => (n > 0 ? <div key={label} style={{ width: `${(n / agingSum) * 100}%`, backgroundColor: c }} title={`${label}: ${n}`} /> : null))}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
          {agingSegs.map(([label, n, c]) => (
            <span key={label} className="inline-flex items-center gap-1 text-[11px] text-slate-500"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: c }} />{label} {n}</span>
          ))}
        </div>
      </div>

      {footer && <div className="mt-3 border-t border-slate-100 pt-3">{footer({ asOfMs, horizon, policy: pol })}</div>}
    </div>
  );
}
