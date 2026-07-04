'use client';

/**
 * Shared Cyber Security KPI helpers — parse logic + the detail-and-logic modal,
 * used by BOTH the main-dashboard panel (CyberKpiPanel) and the KPI Report page
 * (KpiReportTab) so the "click a KPI → see its quarterly table + logic" behaviour
 * is identical everywhere. KPI values come from the source workbook (percentages
 * already ×100). kpi_report is a reporting tool, not a scored assessment.
 */

import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { Info, Target } from 'lucide-react';

export const GOOD = '#059669';
export const BAD = '#e11d48';
export const TEAL = '#0d9488';
export const KPI_FORMAT = 'kpi_report';

export type Q = { q: number; target: number | null; actual: number | null };
export type Kpi = {
  domain: string; topic: string; def: string; type: string; freq: string; source: string;
  prior: number | null; quarters: Q[];
  latest: Q | null; lowerBetter: boolean; onTarget: boolean | null;
};

const num = (s: string) => { const n = parseFloat(String(s).replace('%', '')); return isNaN(n) ? null : n; };

// A KPI reads better when higher UNLESS it counts a bad thing ("...not monitored",
// "...open past deadline"). Then the target is a ceiling and lower is better.
export const isLowerBetter = (text: string) => /\bnot\b|past deadline|open past|do not|unmonitored/i.test(text);

export const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v)}%`);

export function parseKpi(item: any): Kpi {
  const r: string = item?.remarks || '';
  const grab = (k: string) => new RegExp(`${k}:\\s*([^|]+)`, 'i').exec(r)?.[1]?.trim() || '';
  const quarters: Q[] = [1, 2, 3, 4].map((q) => {
    const m = new RegExp(`Q${q}:\\s*([^/|]+)/([^|]+)`, 'i').exec(r);
    return { q, target: m ? num(m[1]) : null, actual: m ? num(m[2]) : null };
  });
  const domain = item?.area_domain || 'General';
  const topic = item?.control_description || grab('Topic') || `KPI ${item?.item_number ?? ''}`;
  const def = grab('Def') || topic;
  const lowerBetter = isLowerBetter(`${topic} ${def}`);
  const withData = quarters.filter((q) => q.target != null && q.actual != null);
  const latest = withData.length ? withData[withData.length - 1] : null;
  const onTarget = latest && latest.target != null && latest.actual != null
    ? (lowerBetter ? latest.actual <= latest.target : latest.actual >= latest.target)
    : null;
  return { domain, topic, def, type: grab('Type') || 'Percentage', freq: grab('Freq'), source: grab('Source'), prior: num(grab('Prior')), quarters, latest, lowerBetter, onTarget };
}

// Tiny Prior→Q1..Q4 trend: actual (teal line) vs target (dashed grey).
export function Spark({ prior, quarters, width = 118, height = 34 }: { prior: number | null; quarters: Q[]; width?: number; height?: number }) {
  const W = width, H = height, pad = 4;
  const series = [prior, ...quarters.map((q) => q.actual)];
  const targets = [null, ...quarters.map((q) => q.target)];
  const n = series.length;
  const x = (i: number) => pad + ((W - 2 * pad) * i) / (n - 1);
  const y = (v: number) => H - pad - ((Math.max(0, Math.min(100, v)) / 100) * (H - 2 * pad));
  const line = (arr: (number | null)[]) => arr.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }} preserveAspectRatio="none">
      <polyline points={line(targets)} fill="none" stroke="#cbd5e1" strokeWidth="1.2" strokeDasharray="3 2" />
      <polyline points={line(series)} fill="none" stroke={TEAL} strokeWidth="1.6" />
      {series.map((v, i) => v != null && <circle key={i} cx={x(i)} cy={y(v)} r="1.6" fill={TEAL} />)}
    </svg>
  );
}

// The "formula behind it" popup: full quarterly Target/Actual table + the exact
// attainment logic (direction-aware) used to mark a KPI on-target or below.
export function KpiDetailModal({ k, onClose }: { k: Kpi | null; onClose: () => void }) {
  const dir = k?.lowerBetter ? 'Lower is better' : 'Higher is better';
  const rel = k?.lowerBetter ? '≤' : '≥';
  const tone = k?.onTarget == null ? '#64748b' : k?.onTarget ? GOOD : BAD;
  const rows: { label: string; target: number | null; actual: number | null }[] = k
    ? [{ label: 'Prior year', target: null, actual: k.prior }, ...k.quarters.map((q) => ({ label: `Q${q.q}`, target: q.target, actual: q.actual }))]
    : [];
  const met = (target: number | null, actual: number | null) => {
    if (target == null || actual == null) return null;
    return k?.lowerBetter ? actual <= target : actual >= target;
  };
  return (
    <AnimatedModal isOpen={k != null} onClose={onClose} size="lg" title={k?.topic} subtitle={k?.domain}>
      {k && (
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap gap-2 text-[11px]">
            {[['Type', k.type || 'Percentage'], ['Frequency', k.freq || '—'], ['Source', k.source || '—'], ['Direction', dir]].map(([l, v]) => (
              <span key={l} className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600"><b className="text-slate-500">{l}:</b> {v}</span>
            ))}
          </div>
          {k.def && <p className="text-[12.5px] leading-5 text-slate-600">{k.def}</p>}

          {k.latest && (
            <div className="rounded-xl p-4" style={{ backgroundColor: `${tone}0f` }}>
              <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: tone }}>Latest quarter · Q{k.latest.q}</p>
              <p className="mt-1 text-[13px] text-slate-700">
                Actual <b className="tabular-nums" style={{ color: tone }}>{pct(k.latest.actual)}</b> vs target <b className="tabular-nums">{pct(k.latest.target)}</b>
                <span className="text-slate-400"> (on target needs actual {rel} target)</span>
                {' → '}
                <b style={{ color: tone }}>{k.onTarget ? 'On target' : 'Below target'}</b>
              </p>
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-400">
                  <th className="px-3 py-2 font-semibold">Period</th>
                  <th className="px-3 py-2 text-right font-semibold">Target</th>
                  <th className="px-3 py-2 text-right font-semibold">Actual</th>
                  <th className="px-3 py-2 text-right font-semibold">Variance</th>
                  <th className="px-3 py-2 text-right font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const ok = met(r.target, r.actual);
                  const variance = r.target != null && r.actual != null ? Math.round((r.actual - r.target) * 10) / 10 : null;
                  return (
                    <tr key={r.label}>
                      <td className="px-3 py-2 text-slate-600">{r.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">{pct(r.target)}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-800">{pct(r.actual)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">{variance == null ? '—' : `${variance >= 0 ? '+' : ''}${variance}pp`}</td>
                      <td className="px-3 py-2 text-right">
                        {ok == null ? <span className="text-slate-300">—</span>
                          : <span className="text-[11px] font-semibold" style={{ color: ok ? GOOD : BAD }}>{ok ? 'On target' : 'Below'}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3.5 py-3">
            <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-slate-700"><Info className="h-3.5 w-3.5" /> How this is read</p>
            <ul className="ml-1 space-y-1 text-[11px] leading-5 text-slate-600">
              <li><b>Direction —</b> {dir}. {k.lowerBetter
                ? 'This KPI measures a negative outcome (its wording flags "not / past deadline"), so the target is a ceiling and actual should stay at or below it.'
                : 'Actual should meet or exceed the target.'}</li>
              <li><b>On target —</b> for the latest reported quarter, <span className="tabular-nums">actual {rel} target</span>. <b>Variance</b> = actual − target (percentage points).</li>
              <li><b>Reporting, not scored —</b> tracked quarterly against targets from the source workbook; intentionally not reduced to a 0–100 maturity score.</li>
            </ul>
          </div>
        </div>
      )}
    </AnimatedModal>
  );
}

// One row for a compact KPI list (used by the KPI Report page). Clicking opens
// the shared detail modal.
export function KpiRow({ k, onOpen }: { k: Kpi; onOpen: () => void }) {
  const a = k.latest?.actual ?? null;
  const t = k.latest?.target ?? null;
  const tone = k.onTarget == null ? '#94a3b8' : k.onTarget ? GOOD : BAD;
  return (
    <button type="button" onClick={onOpen}
      className="group flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-slate-50">
      <div className="min-w-0 flex-1">
        <p className="text-[9.5px] font-semibold uppercase tracking-wide text-slate-400">{k.domain}</p>
        <p className="truncate text-[12.5px] font-medium text-slate-700" title={k.topic}>{k.topic}</p>
      </div>
      <div className="hidden w-[110px] flex-shrink-0 sm:block"><Spark prior={k.prior} quarters={k.quarters} width={110} height={28} /></div>
      <div className="w-[74px] flex-shrink-0 text-right">
        <div className="text-[13px] font-bold tabular-nums" style={{ color: tone }}>{pct(a)}</div>
        <div className="flex items-center justify-end gap-0.5 text-[9.5px] text-slate-400"><Target className="h-2.5 w-2.5" />{pct(t)}</div>
      </div>
      <span className="w-[68px] flex-shrink-0 rounded-full px-1.5 py-0.5 text-center text-[9px] font-bold uppercase" style={{ backgroundColor: `${tone}14`, color: tone }}>
        {k.onTarget == null ? 'n/a' : k.onTarget ? 'On target' : 'Below'}
      </span>
    </button>
  );
}
