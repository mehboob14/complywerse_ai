'use client';

// Shapes, money formatting and the loss exceedance curve shared by the FAIR pages.

import { useId, useState } from 'react';

export type Triple = [number, number, number];
export interface FairInputs {
  tef: Triple; vulnerability: Triple;
  primary: { response: Triple; productivity: Triple; replacement: Triple };
  secondary: { probability: Triple; fines: Triple; reputation: Triple; competitive: Triple };
  iterations: number;
}
export interface FairResult {
  iterations: number; lef: { mean: number; p10: number; p90: number };
  annual: { chance: number; mean: number; p50: number; p90: number; p95: number; p99: number; max: number };
  per_event: { p10: number; p50: number; p90: number };
  split: { primary: number; secondary: number; secondary_share: number };
  lec: Array<{ loss: number; chance: number }>; liability_cap: number;
}
export interface FairAnalysis {
  id: number; vendor: { id: number; name: string; tier: string | null }; name: string;
  effect: 'confidentiality' | 'integrity' | 'availability'; scenario: string | null; asset: string | null; threat: string | null;
  status: 'draft' | 'final'; currency: string; annual: FairResult['annual'] | null; liability_cap: number | null;
  updated_at: string; run_at: string | null; row_version: number;
  inputs?: FairInputs; notes?: string[]; result?: FairResult | null;
}

export const EFFECT_LABEL: Record<FairAnalysis['effect'], string> = {
  confidentiality: 'Data exposed', integrity: 'Data tampered with', availability: 'Service stops',
};

export function money(value: number | null | undefined, currency = 'USD', compact = true): string {
  if (value === null || value === undefined) return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, notation: compact ? 'compact' : 'standard', maximumFractionDigits: compact ? 1 : 0 }).format(value);
  } catch {
    return `${Math.round(value).toLocaleString()} ${currency}`;
  }
}

export const pct = (x: number | null | undefined, digits = 0) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(digits)}%`);

export async function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

/** For each amount, the chance a year costs at least that much. One series, so the
 *  title names it; a crosshair reads the nearest point; the same points are
 *  available as a table. */
export function LossCurve({ points, currency, marks }: {
  points: Array<{ loss: number; chance: number }>; currency: string; marks?: Array<{ loss: number; label: string }>;
}) {
  const [at, setAt] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const id = useId();
  if (!points.length) return <p className="text-sm text-slate-500">No simulated year had a loss, so there is no curve to draw.</p>;
  const W = 640, H = 240, L = 48, R = 12, T = 12, B = 30;
  const lx = points.map((p) => Math.log10(Math.max(1, p.loss)));
  const x0 = Math.floor(Math.min(...lx)), x1 = Math.ceil(Math.max(...lx));
  const x = (loss: number) => L + ((Math.log10(Math.max(1, loss)) - x0) / Math.max(1e-9, x1 - x0)) * (W - L - R);
  const top = Math.min(1, Math.ceil((points[0].chance * 1.1) * 10) / 10 || 0.1);
  const y = (c: number) => T + (1 - c / top) * (H - T - B);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.loss).toFixed(1)},${y(p.chance).toFixed(1)}`).join(' ');
  const ticks = Array.from({ length: x1 - x0 + 1 }, (_, i) => 10 ** (x0 + i));
  const yTicks = [0, top / 2, top];
  const pick = (clientX: number, rect: DOMRect) => {
    const px = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    points.forEach((p, i) => { if (Math.abs(x(p.loss) - px) < Math.abs(x(points[best].loss) - px)) best = i; });
    setAt(best);
  };
  const shown = at !== null ? points[at] : null;
  return (
    <div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-labelledby={`${id}-t`} tabIndex={0}
          onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())} onPointerLeave={() => setAt(null)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') setAt(Math.min(points.length - 1, (at ?? -1) + 1));
            if (e.key === 'ArrowLeft') setAt(Math.max(0, (at ?? points.length) - 1));
          }} onBlur={() => setAt(null)}>
          <title id={`${id}-t`}>Loss exceedance curve: the chance a year costs at least each amount</title>
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeWidth={1} />
              <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#64748b">{pct(t)}</text>
            </g>
          ))}
          {ticks.map((t) => (
            <text key={t} x={x(t)} y={H - 10} textAnchor="middle" fontSize={11} fill="#64748b">{money(t, currency)}</text>
          ))}
          <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="#cbd5e1" strokeWidth={1} />
          {(marks || []).filter((m) => m.loss > 0).map((m) => (
            <g key={m.label}>
              <line x1={x(m.loss)} x2={x(m.loss)} y1={T} y2={y(0)} stroke="#cbd5e1" strokeWidth={1} />
              <text x={x(m.loss) + 4} y={T + 10} fontSize={11} fill="#475569">{m.label}</text>
            </g>
          ))}
          <path d={path} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className="text-primary-600" />
          {shown && (
            <>
              <line x1={x(shown.loss)} x2={x(shown.loss)} y1={T} y2={y(0)} stroke="#94a3b8" strokeWidth={1} />
              <circle cx={x(shown.loss)} cy={y(shown.chance)} r={4} fill="currentColor" stroke="#ffffff" strokeWidth={2} className="text-primary-600" />
            </>
          )}
        </svg>
        {shown && (
          <div className="pointer-events-none absolute top-2 rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow"
            style={{ left: `min(max(0px, calc(${(x(shown.loss) / W) * 100}% - 70px)), calc(100% - 150px))` }}>
            <b className="font-semibold">{pct(shown.chance, 1)}</b> <span className="text-slate-300">chance of {money(shown.loss, currency)} or more</span>
          </div>
        )}
      </div>
      <button type="button" onClick={() => setTable(!table)} aria-expanded={table} className="mt-1 text-xs text-primary-700 hover:underline">
        {table ? 'Hide the table' : 'Show as a table'}
      </button>
      {table && (
        <table className="mt-2 w-full max-w-sm text-xs">
          <thead className="text-left text-slate-500"><tr><th className="py-1 font-medium">A year costing at least</th><th className="py-1 text-right font-medium">Chance</th></tr></thead>
          <tbody className="divide-y divide-slate-100 tabular-nums">
            {points.map((p) => <tr key={p.loss}><td className="py-1">{money(p.loss, currency, false)}</td><td className="py-1 text-right">{pct(p.chance, 1)}</td></tr>)}
          </tbody>
        </table>
      )}
    </div>
  );
}
