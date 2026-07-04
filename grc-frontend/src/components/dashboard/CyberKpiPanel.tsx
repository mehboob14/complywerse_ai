'use client';

/**
 * Cyber Security KPI panel for the MAIN dashboard. Mirrors the Excel KPI Report's
 * "Dashboard" sheet: each KPI carries a prior-year baseline and four quarters of
 * Target + Actual, grouped by cybersecurity domain. This is a REPORTING view, not
 * a scored module (per the kpi_report design decision), so it summarises latest-
 * quarter attainment (Actual vs Target, direction-aware) rather than a 0-100 score.
 *
 * Data: the same live endpoints the full KPI Report page uses —
 *   GET /compliance/assessments?assessment_format=kpi_report   (find the report)
 *   GET /compliance/assessments/{id}                           (items = KPIs)
 * Nothing is hardcoded; percentages are the workbook's own values.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import apiClient from '@/lib/api';
import { Activity, ArrowRight, Target, Info } from 'lucide-react';
import { AnimatedModal } from '@/components/ui/AnimatedModal';

const KPI_FORMAT = 'kpi_report';
const GOOD = '#059669';
const BAD = '#e11d48';
const TEAL = '#0d9488';

type Q = { q: number; target: number | null; actual: number | null };
type Kpi = {
  domain: string; topic: string; def: string; freq: string;
  prior: number | null; quarters: Q[];
  latest: Q | null; lowerBetter: boolean; onTarget: boolean | null;
};

const num = (s: string) => { const n = parseFloat(String(s).replace('%', '')); return isNaN(n) ? null : n; };

// A KPI reads better when higher UNLESS it counts a bad thing ("...not monitored",
// "...open past deadline"). Then the target is a ceiling and lower is better.
const isLowerBetter = (text: string) => /\bnot\b|past deadline|open past|do not|unmonitored/i.test(text);

function parseKpi(item: any): Kpi {
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
  return { domain, topic, def, freq: grab('Freq'), prior: num(grab('Prior')), quarters, latest, lowerBetter, onTarget };
}

const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v)}%`);

// Tiny Prior→Q1..Q4 trend: actual (teal line) vs target (dashed grey).
function Spark({ prior, quarters }: { prior: number | null; quarters: Q[] }) {
  const W = 118, H = 34, pad = 4;
  const series = [prior, ...quarters.map((q) => q.actual)];
  const targets = [null, ...quarters.map((q) => q.target)];
  const n = series.length;
  const x = (i: number) => pad + ((W - 2 * pad) * i) / (n - 1);
  const y = (v: number) => H - pad - ((Math.max(0, Math.min(100, v)) / 100) * (H - 2 * pad));
  const line = (arr: (number | null)[]) => arr.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[34px] w-full" preserveAspectRatio="none">
      <polyline points={line(targets)} fill="none" stroke="#cbd5e1" strokeWidth="1.2" strokeDasharray="3 2" />
      <polyline points={line(series)} fill="none" stroke={TEAL} strokeWidth="1.6" />
      {series.map((v, i) => v != null && <circle key={i} cx={x(i)} cy={y(v)} r="1.6" fill={TEAL} />)}
    </svg>
  );
}

function KpiCell({ k, onOpen }: { k: Kpi; onOpen: () => void }) {
  const a = k.latest?.actual ?? null;
  const t = k.latest?.target ?? null;
  const tone = k.onTarget == null ? '#94a3b8' : k.onTarget ? GOOD : BAD;
  return (
    <button type="button" onClick={onOpen}
      className="group rounded-xl border border-slate-200 bg-white p-3 text-left transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-sm">
      <div className="mb-1 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[9.5px] font-semibold uppercase tracking-wide text-slate-400">{k.domain}</p>
          <p className="line-clamp-2 text-[11.5px] font-medium leading-tight text-slate-700" title={k.topic}>{k.topic}</p>
        </div>
        <span className="flex-shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase" style={{ backgroundColor: `${tone}14`, color: tone }}>
          {k.onTarget == null ? 'n/a' : k.onTarget ? 'On target' : 'Below'}
        </span>
      </div>
      <Spark prior={k.prior} quarters={k.quarters} />
      <div className="mt-1 flex items-center justify-between text-[10.5px]">
        <span className="font-bold tabular-nums" style={{ color: tone }}>{pct(a)} <span className="font-normal text-slate-400">actual</span></span>
        <span className="flex items-center gap-1 text-slate-500"><Target className="h-3 w-3" />{pct(t)} target</span>
      </div>
      <p className="mt-1.5 text-[9px] font-medium text-slate-300 group-hover:text-teal-500">Click for detail &amp; logic →</p>
    </button>
  );
}

// The "formula behind it" popup: full quarterly Target/Actual table + the exact
// attainment logic (direction-aware) used to mark a KPI on-target or below.
function KpiDetailModal({ k, onClose }: { k: Kpi | null; onClose: () => void }) {
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
          {/* meta */}
          <div className="flex flex-wrap gap-2 text-[11px]">
            {[['Type', 'Percentage'], ['Frequency', k.freq || '—'], ['Direction', dir]].map(([l, v]) => (
              <span key={l} className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600"><b className="text-slate-500">{l}:</b> {v}</span>
            ))}
          </div>
          {k.def && <p className="text-[12.5px] leading-5 text-slate-600">{k.def}</p>}

          {/* latest attainment banner */}
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

          {/* quarterly table */}
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-400">
                  <th className="px-3 py-2 font-semibold">Period</th>
                  <th className="px-3 py-2 text-right font-semibold">Target</th>
                  <th className="px-3 py-2 text-right font-semibold">Actual</th>
                  <th className="px-3 py-2 text-right font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const ok = met(r.target, r.actual);
                  return (
                    <tr key={r.label}>
                      <td className="px-3 py-2 text-slate-600">{r.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">{pct(r.target)}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-800">{pct(r.actual)}</td>
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

          {/* the logic / formula */}
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3.5 py-3">
            <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-slate-700"><Info className="h-3.5 w-3.5" /> How this is read</p>
            <ul className="ml-1 space-y-1 text-[11px] leading-5 text-slate-600">
              <li><b>Direction —</b> {dir}. {k.lowerBetter
                ? 'This KPI measures a negative outcome (its wording flags "not / past deadline"), so the target is a ceiling and actual should stay at or below it.'
                : 'Actual should meet or exceed the target.'}</li>
              <li><b>On target —</b> for the latest reported quarter, <span className="tabular-nums">actual {rel} target</span>.</li>
              <li><b>Reporting, not scored —</b> the KPI Report is tracked quarterly against targets (from the source workbook); it is intentionally not reduced to a 0–100 maturity score.</li>
            </ul>
          </div>
        </div>
      )}
    </AnimatedModal>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2 text-center">
      <div className="text-[19px] font-bold leading-none tabular-nums" style={{ color: tone ?? '#334155' }}>{value}</div>
      <div className="mt-1 text-[9.5px] uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  );
}

export default function CyberKpiPanel() {
  const [sel, setSel] = useState<Kpi | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['main-kpi-report'],
    queryFn: async () => {
      const list = (await apiClient.get('/compliance/assessments', { params: { limit: 50, assessment_format: KPI_FORMAT } })).data;
      const arr = list?.assessments || list || [];
      if (!Array.isArray(arr) || !arr.length) return null;
      const detail = (await apiClient.get(`/compliance/assessments/${arr[0].id}`)).data;
      return { id: arr[0].id, name: detail?.name || 'Cyber Security KPI Report', items: detail?.items || [] };
    },
    staleTime: 60_000,
  });

  if (isLoading) return <div className="skeleton mb-6 h-64 rounded-2xl" />;
  if (!data || !data.items.length) return null;

  const kpis = data.items.map(parseKpi);
  const rated = kpis.filter((k) => k.onTarget != null);
  const onT = rated.filter((k) => k.onTarget).length;
  const offT = rated.length - onT;
  const latestActuals = kpis.map((k) => k.latest?.actual).filter((v): v is number => v != null);
  const avgActual = latestActuals.length ? Math.round(latestActuals.reduce((a, b) => a + b, 0) / latestActuals.length) : null;
  const domains = new Set(kpis.map((k) => k.domain)).size;
  const latestQ = Math.max(0, ...kpis.map((k) => k.latest?.q ?? 0));

  return (
    <div className="mb-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: `${TEAL}14` }}>
            <Activity className="h-4 w-4" style={{ color: TEAL }} />
          </span>
          <div>
            <h3 className="text-[15px] font-semibold text-slate-800">Cyber Security KPIs</h3>
            <p className="text-[11px] text-slate-400">Quarterly target vs actual · {kpis.length} KPIs across {domains} domains{latestQ ? ` · latest Q${latestQ}` : ''}</p>
          </div>
        </div>
        <Link href="/assessments/cs_kpi" className="group inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[12px] font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-800">
          Open KPI Report <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2.5 px-5 py-3.5 sm:grid-cols-4">
        <Tile label={`On target (Q${latestQ})`} value={`${onT}`} tone={GOOD} />
        <Tile label="Below target" value={`${offT}`} tone={offT > 0 ? BAD : GOOD} />
        <Tile label="Avg actual" value={avgActual == null ? '—' : `${avgActual}%`} tone={TEAL} />
        <Tile label="KPIs · domains" value={`${kpis.length} · ${domains}`} />
      </div>

      <div className="grid grid-cols-1 gap-2.5 px-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {kpis.map((k, i) => <KpiCell key={i} k={k} onOpen={() => setSel(k)} />)}
      </div>

      {/* inline logic note so the numbers aren't unexplained */}
      <div className="mx-5 mb-5 mt-3 flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3.5 py-2.5">
        <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
        <p className="text-[10.5px] leading-4 text-slate-500">
          <b className="text-slate-600">On target</b> = KPIs whose latest-quarter actual meets its target — direction-aware
          (a KPI that counts a bad outcome, e.g. “% not monitored”, is on target when actual stays <b>at or below</b> target).
          {' '}<b className="text-slate-600">Avg actual</b> = mean of the latest-quarter actuals. Values come from the source KPI
          workbook. <b className="text-slate-600">Click any KPI</b> for its full quarterly table and the exact logic.
        </p>
      </div>

      <KpiDetailModal k={sel} onClose={() => setSel(null)} />
    </div>
  );
}
