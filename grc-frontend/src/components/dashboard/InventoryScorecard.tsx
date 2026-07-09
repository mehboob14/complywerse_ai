'use client';

/**
 * IT Assets — Inventory scorecard (board-level, formula-driven). Sits at the top
 * of /assets above the existing donuts/table. Seven scored sections (inventory
 * hygiene, criticality coverage, vulnerability exposure, remediation health, CIS
 * benchmark, scan & monitoring, lifecycle & exposure) blended into one inventory
 * score, each metric's formula one click away. Data: GET
 * /assets/inventory-overview (all scoring server-side).
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { AlertTriangle, ShieldCheck, ServerCog, SlidersHorizontal } from 'lucide-react';
import { scoreBand, ScoreRing, SectionDetailModal, SectionGraphCard, type OverviewSection } from '@/components/dashboard/score-kit';
import { SectionWeightTunerModal } from '@/components/dashboard/score-tuning';
import { SCORECARD_QUERY_KEYS } from '@/components/dashboard/scorecard-query-keys';

const ASSETS_TUNING = { configBase: '/assets', invalidateKey: [...SCORECARD_QUERY_KEYS.assets] as unknown[] };

type Payload = {
  as_of: string | null;
  counts: { assets?: number; vulnerabilities?: number; open_vulnerabilities?: number };
  performance: { score: number | null; grade: string | null };
  sections: Record<string, OverviewSection>;
  attention_queue: Record<string, number>;
};

const ORDER = ['hygiene', 'criticality', 'vulnerability', 'vuln_health', 'cis', 'scan', 'lifecycle'];
const ATTENTION: Array<{ key: string; label: string; color: string }> = [
  { key: 'open_critical_high_vulns', label: 'Open critical/high vulnerabilities', color: '#e11d48' },
  { key: 'assets_without_owner', label: 'Assets with no owner', color: '#d97706' },
  { key: 'assets_unassessed', label: 'Assets not criticality-assessed', color: '#8b5cf6' },
  { key: 'stale_assets', label: 'Stale assets (not scanned 30d+)', color: '#64748b' },
  { key: 'internet_facing_unassessed', label: 'Internet-facing, unassessed', color: '#0ea5e9' },
];

function pct(n: number | null | undefined) { return n == null ? '—' : Math.round(n); }

export default function InventoryScorecard() {
  const [open, setOpen] = useState<OverviewSection | null>(null);
  const [tuning, setTuning] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: [...SCORECARD_QUERY_KEYS.assets],
    queryFn: async () => {
      try { return (await apiClient.get('/assets/inventory-overview')).data as Payload; }
      catch { return null; }
    },
  });

  if (isLoading) {
    return (
      <div className="mb-5 space-y-3">
        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1fr_0.7fr]">{[1, 2].map((i) => <div key={i} className="skeleton h-40 rounded-2xl" />)}</div>
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-5">{[1, 2, 3, 4, 5, 6, 7].map((i) => <div key={i} className="skeleton h-44 rounded-2xl" />)}</div>
      </div>
    );
  }

  const payload = data ?? {
    as_of: null,
    counts: { assets: 0, vulnerabilities: 0, open_vulnerabilities: 0 },
    performance: { score: null, grade: null },
    sections: {},
    attention_queue: { total: 0 },
  } as Payload;

  const perf = payload.performance;
  const band = scoreBand(perf.score);
  const sections = ORDER.map((k) => payload.sections[k]).filter((s): s is OverviewSection => Boolean(s));
  const attn = ATTENTION.map((a) => ({ ...a, count: payload.attention_queue?.[a.key] ?? 0 }));
  const attnTotal = payload.attention_queue?.total ?? 0;
  const scoredSections = sections.filter((s) => s.score != null);

  return (
    <div className="mb-6 space-y-3.5">
      {/* hero: performance + attention */}
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1fr_0.75fr]">
        <div className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
            <div className="flex min-w-0 items-center gap-4">
              <ScoreRing score={perf.score} size={84} />
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><ServerCog className="h-3.5 w-3.5" /> Inventory Score</p>
                {perf.grade && <span className="mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ backgroundColor: `${band.hex}14`, color: band.hex }}>{perf.grade}</span>}
                <p className="mt-1.5 text-[11px] text-slate-400">{payload.counts.assets ?? 0} assets · {payload.counts.open_vulnerabilities ?? 0} open vulns · target 85</p>
              </div>
            </div>
            {!tuning && (
              <button type="button" onClick={() => setTuning(true)}
                className="inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-slate-200 px-2 py-1 text-[10.5px] font-medium text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700">
                <SlidersHorizontal className="h-3 w-3" /> Adjust weights
              </button>
            )}
          </div>
          <div className="mt-4 space-y-2">
            {scoredSections.length ? scoredSections.map((s) => {
              const b = scoreBand(s.score);
              return (
                <div key={s.key} className="flex items-center gap-2">
                  <span className="w-32 flex-shrink-0 truncate text-[10.5px] text-slate-500">{s.label}</span>
                  <span className="relative h-1.5 flex-1 rounded-full bg-slate-100">
                    <span className="block h-1.5 rounded-full" style={{ width: `${s.score ?? 0}%`, backgroundColor: b.hex }} />
                    <span className="absolute inset-y-0 w-px bg-slate-300" style={{ left: '85%' }} />
                  </span>
                  <span className="w-7 flex-shrink-0 text-right text-[10.5px] font-semibold" style={{ color: b.hex }}>{pct(s.score)}</span>
                </div>
              );
            }) : (
              <p className="text-[11px] text-slate-400">No scored inventory areas yet — add assets or run a vulnerability scan.</p>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-800"><AlertTriangle className="h-4 w-4 text-amber-500" /> Needs Attention</span>
            <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-white">{attnTotal}</span>
          </div>
          <div className="divide-y divide-slate-50">
            {attn.map((i) => (
              <div key={i.key} className="flex items-center justify-between py-2 text-[11.5px] text-slate-600">
                <span className="flex items-center gap-2 truncate"><span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: i.count > 0 ? i.color : '#e2e8f0' }} />{i.label}</span>
                <span className={`ml-2 text-sm font-bold tabular-nums ${i.count > 0 ? 'text-slate-900' : 'text-slate-300'}`}>{i.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* section cards — Governance-style concentric radial rings (one ring per metric) */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {sections.map((s) => <SectionGraphCard key={s.key} section={s} onOpen={() => setOpen(s)} />)}
      </div>

      {tuning && (
        <SectionWeightTunerModal sections={sections} configBase={ASSETS_TUNING.configBase} invalidateKey={ASSETS_TUNING.invalidateKey} onClose={() => setTuning(false)} />
      )}
      <SectionDetailModal section={open} onClose={() => setOpen(null)} tuning={ASSETS_TUNING} />
    </div>
  );
}
