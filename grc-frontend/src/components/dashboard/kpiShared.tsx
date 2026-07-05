'use client';

/**
 * Shared Cyber Security KPI helpers. The KPI catalog (which KPIs exist, their
 * domain + definition) comes from the uploaded workbook; the ACTUAL values are
 * computed LIVE server-side from real modules where the platform genuinely owns
 * the data (GET /compliance/assessments/kpi-live) and overlaid here. KPIs with
 * no in-platform source are flagged "external" — no fabricated number. Nothing
 * static. Used by both the main-dashboard panel and the KPI Report page.
 */

import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { Info, Target, Activity, ExternalLink } from 'lucide-react';

export const GOOD = '#059669';
export const BAD = '#e11d48';
export const TEAL = '#0d9488';
export const KPI_FORMAT = 'kpi_report';

export type Point = { date: string; value: number | null };
export type LiveMetric = {
  label: string; actual: number | null; numerator: number; denominator: number;
  formula: string; target: number | null; direction: string; source: string; href: string; on_target: boolean | null;
  history?: Point[];
};
export type Kpi = {
  domain: string; topic: string; def: string; extSource: string;
  live: boolean; lowerBetter: boolean;
  actual: number | null; target: number | null; onTarget: boolean | null;
  numerator?: number; denominator?: number; formula?: string; source: string; href?: string;
  history: Point[];
};

// Which cybersecurity domains map to a live in-platform metric.
const DOMAIN_TO_METRIC: Record<string, string> = {
  'cybersecurity assurance & compliance': 'policy_review',
  'identity and access management': 'access_cert',
  'vulnerability management': 'vuln_sla',
  'asset management': 'asset_monitoring',
  'physical security': 'asset_vuln_free',
  'risk management': 'risk_treatment',
  'business continuity': 'incident_resolution',
};

function catalog(item: any) {
  const r: string = item?.remarks || '';
  const grab = (k: string) => new RegExp(`${k}:\\s*([^|]+)`, 'i').exec(r)?.[1]?.trim() || '';
  const domain = item?.area_domain || 'General';
  const topic = item?.control_description || grab('Topic') || `KPI ${item?.item_number ?? ''}`;
  return { domain, topic, def: grab('Def') || topic, extSource: grab('Source') || 'an external system' };
}

// Build the KPI list: catalog (from workbook) overlaid with LIVE metrics.
export function buildKpis(items: any[], metrics: Record<string, LiveMetric>): Kpi[] {
  return (items || []).map((it) => {
    const c = catalog(it);
    const key = DOMAIN_TO_METRIC[c.domain.trim().toLowerCase()];
    const m = key ? metrics?.[key] : undefined;
    if (m) {
      return {
        domain: c.domain, topic: m.label, def: m.formula, extSource: c.extSource,
        live: true, lowerBetter: m.direction === 'lower',
        actual: m.actual, target: m.target, onTarget: m.on_target,
        numerator: m.numerator, denominator: m.denominator, formula: m.formula, source: m.source, href: m.href,
        history: m.history || [],
      };
    }
    return {
      domain: c.domain, topic: c.topic, def: c.def, extSource: c.extSource,
      live: false, lowerBetter: false, actual: null, target: null, onTarget: null, source: 'External source', history: [],
    };
  });
}

export const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v)}%`);
const clamp = (v: number | null) => Math.max(0, Math.min(100, v ?? 0));

// Auto-zoom the y-axis to the data (+ target) so the trend fills the chart height
// instead of hugging a flat line — the way a trading chart scales to its range.
function makeY(pts: Point[], target: number | null, H: number, padT: number, padB: number) {
  const vals = pts.map((p) => p.value as number);
  const refs = target != null ? [...vals, target] : vals;
  let lo = Math.min(...refs), hi = Math.max(...refs);
  const span = hi - lo;
  const pad = Math.max(4, span * 0.18);
  lo = Math.max(0, lo - pad);
  hi = Math.min(100, hi + pad);
  if (hi - lo < 1) hi = lo + 1;
  return (v: number) => H - padB - ((clamp(v) - lo) / (hi - lo)) * (H - padT - padB);
}

// Actual bar with a target marker (fallback when there isn't enough history).
export function TargetBar({ actual, target, tone }: { actual: number | null; target: number | null; tone: string }) {
  return (
    <div className="relative h-2 w-full rounded-full bg-slate-100">
      <div className="h-2 rounded-full" style={{ width: `${clamp(actual)}%`, backgroundColor: tone }} />
      {target != null && <div className="absolute -top-0.5 h-3 w-[2px] rounded bg-slate-500" style={{ left: `calc(${clamp(target)}% - 1px)` }} title={`target ${Math.round(target)}%`} />}
    </div>
  );
}

// The trend line — teal actual over time vs a dashed target line ("trading chart").
export function Trend({ history, target, actual, tone, width = 130, height = 40 }: { history: Point[]; target: number | null; actual: number | null; tone: string; width?: number; height?: number }) {
  const pts = (history || []).filter((h) => h.value != null);
  if (pts.length < 2) return <TargetBar actual={actual} target={target} tone={tone} />;
  const W = width, H = height, pad = 4;
  const n = pts.length;
  const x = (i: number) => pad + ((W - 2 * pad) * i) / (n - 1);
  const y = makeY(pts, target, H, pad, pad);
  const line = pts.map((h, i) => `${x(i).toFixed(1)},${y(h.value as number).toFixed(1)}`).join(' ');
  const lastY = y(pts[n - 1].value as number);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }} preserveAspectRatio="none">
      {target != null && <line x1={pad} x2={W - pad} y1={y(target)} y2={y(target)} stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3 2" />}
      <polyline points={line} fill="none" stroke={TEAL} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(n - 1)} cy={lastY} r="2.4" fill={TEAL} />
    </svg>
  );
}

export function toneOf(k: Kpi) {
  if (!k.live) return '#94a3b8';
  return k.onTarget == null ? '#94a3b8' : k.onTarget ? GOOD : BAD;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function dlabel(iso: string) {
  const p = (iso || '').split('-');
  return p.length < 3 ? '' : `${MONTHS[+p[1] - 1] || ''} ${+p[2]}`;
}

// The full trend chart — teal actual line with value labels, dashed target line,
// dated x-axis. The big "trading chart" view; shown inline on cards and in drill-in.
export function RichTrend({ history, target, width = 520, height = 150 }: { history: Point[]; target: number | null; width?: number; height?: number }) {
  const pts = (history || []).filter((h) => h.value != null);
  if (pts.length < 2) return null;
  const W = width, H = height, padL = 8, padR = 16, padT = 26, padB = 22;
  const n = pts.length;
  const x = (i: number) => padL + ((W - padL - padR) * i) / (n - 1);
  const y = makeY(pts, target, H, padT, padB);
  const line = pts.map((h, i) => `${x(i).toFixed(1)},${y(h.value as number).toFixed(1)}`).join(' ');
  const showLbl = (i: number) => i === 0 || i === n - 1 || i % 2 === 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: H }}>
      {[25, 50, 75].map((g) => <line key={g} x1={padL} x2={W - padR} y1={y(g)} y2={y(g)} stroke="#f1f5f9" strokeWidth="1" />)}
      {target != null && (
        <>
          <line x1={padL} x2={W - padR} y1={y(target)} y2={y(target)} stroke="#94a3b8" strokeWidth="1.2" strokeDasharray="4 3" />
          <text x={W - padR} y={y(target) - 4} fontSize="9" fill="#94a3b8" textAnchor="end">target {Math.round(target)}%</text>
        </>
      )}
      <polyline points={line} fill="none" stroke={TEAL} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((h, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(h.value as number)} r={i === n - 1 ? 3.4 : 2.3} fill={TEAL} />
          {showLbl(i) && <text x={x(i)} y={y(h.value as number) - 7} fontSize="9" fontWeight="600" fill={TEAL} textAnchor="middle">{Math.round(h.value as number)}%</text>}
          {(i % 2 === 0 || i === n - 1) && <text x={x(i)} y={H - 6} fontSize="8" fill="#94a3b8" textAnchor="middle">{dlabel(h.date)}</text>}
        </g>
      ))}
    </svg>
  );
}

// Recent snapshots as period cards (value, vs target, variance) — like the old
// quarterly Q1–Q4 cards, but on the real weekly history.
export function PeriodCards({ history, target }: { history: Point[]; target: number | null }) {
  const recent = (history || []).filter((h) => h.value != null).slice(-5);
  if (!recent.length) return null;
  return (
    <div className="grid grid-cols-5 gap-1.5">
      {recent.map((p, i) => {
        const v = Math.round(p.value as number);
        const varc = target != null ? Math.round((p.value as number) - target) : null;
        return (
          <div key={i} className="rounded-lg border border-slate-100 px-1.5 py-1.5 text-center">
            <div className="text-[8.5px] text-slate-400">{dlabel(p.date)}</div>
            <div className="text-[12px] font-bold tabular-nums" style={{ color: TEAL }}>{v}%</div>
            {target != null && <div className="text-[8px] text-slate-400">vs {Math.round(target)}%</div>}
            {varc != null && <div className="text-[9px] font-semibold tabular-nums" style={{ color: varc >= 0 ? GOOD : BAD }}>{varc >= 0 ? '+' : ''}{varc}pp</div>}
          </div>
        );
      })}
    </div>
  );
}

// Detail popup: for LIVE KPIs the exact computation (numerator/denominator/formula
// + link to the module); for EXTERNAL KPIs an honest "no in-platform source" note.
export function KpiDetailModal({ k, onClose }: { k: Kpi | null; onClose: () => void }) {
  const tone = k ? toneOf(k) : '#64748b';
  const rel = k?.lowerBetter ? '≤' : '≥';
  return (
    <AnimatedModal isOpen={k != null} onClose={onClose} size="lg" title={k?.topic} subtitle={k?.domain}>
      {k && (
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold" style={{ backgroundColor: k.live ? `${TEAL}14` : '#f1f5f9', color: k.live ? TEAL : '#64748b' }}>
              {k.live ? <><Activity className="h-3 w-3" /> Live from module</> : <><ExternalLink className="h-3 w-3" /> External source</>}
            </span>
            {k.live && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600"><b className="text-slate-500">Source:</b> {k.source}</span>}
            {k.live && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600"><b className="text-slate-500">Direction:</b> {k.lowerBetter ? 'Lower is better' : 'Higher is better'}</span>}
          </div>

          {k.live ? (
            <>
              {k.history.filter((h) => h.value != null).length >= 2 && (
                <div className="rounded-xl border border-slate-100 bg-white p-3">
                  <div className="mb-1 flex items-center justify-between text-[10px] text-slate-400">
                    <span className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1"><span className="inline-block h-[2px] w-4" style={{ background: TEAL }} /> actual</span>
                      <span className="inline-flex items-center gap-1"><span className="inline-block h-[2px] w-4 border-t border-dashed border-slate-400" /> target</span>
                    </span>
                    <span>recorded weekly · live</span>
                  </div>
                  <RichTrend history={k.history} target={k.target} />
                  <div className="mt-2"><PeriodCards history={k.history} target={k.target} /></div>
                </div>
              )}
              <div className="rounded-xl p-4" style={{ backgroundColor: `${tone}0f` }}>
                <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: tone }}>Current</p>
                <p className="mt-1 text-[13px] text-slate-700">
                  Actual <b className="tabular-nums" style={{ color: tone }}>{pct(k.actual)}</b> vs target <b className="tabular-nums">{pct(k.target)}</b>
                  <span className="text-slate-400"> (on target needs actual {rel} target)</span>
                  {' → '}<b style={{ color: tone }}>{k.onTarget ? 'On target' : 'Below target'}</b>
                </p>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 px-3.5 py-3">
                <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-slate-700"><Info className="h-3.5 w-3.5" /> How this is computed</p>
                <p className="text-[12px] leading-5 text-slate-600">
                  <span className="tabular-nums font-semibold text-slate-800">{k.numerator}</span> ÷ <span className="tabular-nums font-semibold text-slate-800">{k.denominator}</span>
                  {' = '}<b className="tabular-nums" style={{ color: tone }}>{pct(k.actual)}</b>
                </p>
                <p className="mt-1 text-[11.5px] text-slate-500">{k.formula}</p>
                <p className="mt-2 text-[11px] leading-5 text-slate-500">Computed live from <b>{k.source}</b> — it recalculates automatically as that module changes. Not entered by hand.</p>
                {k.href && <a href={k.href} className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-semibold" style={{ color: TEAL }}>Open {k.source.split(' - ')[0].split(' ')[0]} module <ExternalLink className="h-3 w-3" /></a>}
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3.5 py-3">
              <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-slate-700"><Info className="h-3.5 w-3.5" /> Why there's no value here</p>
              <p className="text-[12px] leading-5 text-slate-600">{k.def}</p>
              <p className="mt-2 text-[11.5px] leading-5 text-slate-500">
                This is an operational metric owned by <b>{k.extSource}</b> — the platform has no live feed for it, so no number is computed or invented.
                If you report it, enter it via the KPI workbook; otherwise it stays flagged as external.
              </p>
            </div>
          )}
        </div>
      )}
    </AnimatedModal>
  );
}

// One row for the KPI Report page's compact list.
export function KpiRow({ k, onOpen }: { k: Kpi; onOpen: () => void }) {
  const tone = toneOf(k);
  return (
    <button type="button" onClick={onOpen} className="group flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-slate-50">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-[9.5px] font-semibold uppercase tracking-wide text-slate-400">{k.domain}</p>
          <span className="rounded px-1 py-px text-[8.5px] font-bold uppercase" style={{ backgroundColor: k.live ? `${TEAL}14` : '#f1f5f9', color: k.live ? TEAL : '#94a3b8' }}>{k.live ? 'Live' : 'External'}</span>
        </div>
        <p className="truncate text-[12.5px] font-medium text-slate-700" title={k.topic}>{k.topic}</p>
      </div>
      <div className="hidden w-[130px] flex-shrink-0 sm:block">
        {k.live ? <Trend history={k.history} target={k.target} actual={k.actual} tone={tone} width={130} height={30} /> : <span className="text-[10px] text-slate-300">not measured in-platform</span>}
      </div>
      <div className="w-[64px] flex-shrink-0 text-right">
        <div className="text-[13px] font-bold tabular-nums" style={{ color: tone }}>{pct(k.actual)}</div>
        {k.live && <div className="flex items-center justify-end gap-0.5 text-[9.5px] text-slate-400"><Target className="h-2.5 w-2.5" />{pct(k.target)}</div>}
      </div>
      <span className="w-[64px] flex-shrink-0 rounded-full px-1.5 py-0.5 text-center text-[9px] font-bold uppercase" style={{ backgroundColor: `${tone}14`, color: tone }}>
        {!k.live ? '—' : k.onTarget == null ? 'n/a' : k.onTarget ? 'On target' : 'Below'}
      </span>
    </button>
  );
}
