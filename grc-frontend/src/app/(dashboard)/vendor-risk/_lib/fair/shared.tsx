'use client';

// The loss exceedance curve of a Comply analysis, and the CSV download helper. The shapes, the money and share formats and the factor rules are fairModel.ts (pure, tested). The curve is one series
// (for each amount, the chance a year costs at least that much), so the title names it; a crosshair reads the nearest point (pointer or the arrow keys); the same points are available as a table. Its
// colours are the design-system tokens and its text is 12px or more.
import { useId, useState } from 'react';
import { Button } from '@/components/ui/ds';
import { money, pct } from './fairModel';

export async function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

const GRID = { stroke: 'var(--ds-border)' } as const;
const AXIS = { fill: 'var(--ds-fg-muted)' } as const;

export function LossCurve({ points, currency, marks }: {
  points: Array<{ loss: number; chance: number }>; currency: string; marks?: Array<{ loss: number; label: string }>;
}) {
  const [at, setAt] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const id = useId();
  if (!points.length) return <p className="text-ds-body text-ds-fg-muted">No simulated year had a loss, so there is no curve to draw.</p>;
  const W = 640, H = 260, L = 52, R = 12, T = 12, B = 34;
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
              <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} style={GRID} strokeWidth={1} />
              <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize={12} style={AXIS}>{pct(t)}</text>
            </g>
          ))}
          {ticks.map((t) => (
            <text key={t} x={x(t)} y={H - 10} textAnchor="middle" fontSize={12} style={AXIS}>{money(t, currency)}</text>
          ))}
          <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} style={{ stroke: 'var(--ds-border-strong)' }} strokeWidth={1} />
          {(marks || []).filter((m) => m.loss > 0).map((m) => (
            <g key={m.label}>
              <line x1={x(m.loss)} x2={x(m.loss)} y1={T} y2={y(0)} style={{ stroke: 'var(--ds-border-strong)' }} strokeWidth={1} strokeDasharray="4 3" />
              <text x={x(m.loss) + 4} y={T + 12} fontSize={12} style={{ fill: 'var(--ds-fg-body)' }}>{m.label}</text>
            </g>
          ))}
          <path d={path} fill="none" style={{ stroke: 'var(--ds-primary)' }} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {shown && (
            <>
              <line x1={x(shown.loss)} x2={x(shown.loss)} y1={T} y2={y(0)} style={{ stroke: 'var(--ds-fg-muted)' }} strokeWidth={1} />
              <circle cx={x(shown.loss)} cy={y(shown.chance)} r={4} style={{ fill: 'var(--ds-primary)', stroke: 'var(--ds-surface)' }} strokeWidth={2} />
            </>
          )}
        </svg>
        {shown && (
          <div className="pointer-events-none absolute top-[8px] rounded-ds-control bg-ds-fg px-[8px] py-[4px] text-ds-label text-ds-surface shadow-ds-pop"
            style={{ left: `min(max(0px, calc(${(x(shown.loss) / W) * 100}% - 70px)), calc(100% - 170px))` }}>
            <b className="font-[600]">{pct(shown.chance, 1)}</b> chance of {money(shown.loss, currency)} or more
          </div>
        )}
      </div>
      <Button variant="link" onClick={() => setTable(!table)} aria-expanded={table}>{table ? 'Hide the table' : 'Show as a table'}</Button>
      {table && (
        <table className="mt-[8px] w-full max-w-sm">
          <thead><tr><th className="py-[4px] text-left text-ds-label font-[600] text-ds-fg-muted">A year costing at least</th><th className="py-[4px] text-right text-ds-label font-[600] text-ds-fg-muted">Chance</th></tr></thead>
          <tbody className="divide-y divide-ds-border tabular-nums">
            {points.map((p) => <tr key={p.loss}><td className="py-[4px] text-ds-body text-ds-fg">{money(p.loss, currency, false)}</td><td className="py-[4px] text-right text-ds-body text-ds-fg">{pct(p.chance, 1)}</td></tr>)}
          </tbody>
        </table>
      )}
    </div>
  );
}
