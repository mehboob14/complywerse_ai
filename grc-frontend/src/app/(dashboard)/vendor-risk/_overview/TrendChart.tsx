'use client';

// The 12-month trend of the portfolio's risk: residual (solid) against inherent (dashed), and the appetite line the tenant set. A picture with its numbers as a table for a screen reader
// (ChartFrame); drawn as plain SVG, so the Overview does not load a chart library. A month with no score is a gap in the line, not a zero (trendModel.ts).
import { ChartFrame } from '@/components/ui/ds';
import type { TrendAnswer } from './overviewData';
import { clamp100, monthWords, runs } from './trendModel';

const RESIDUAL = '#0f766e';                    // --ds-primary: an SVG attribute cannot read a class
const INHERENT = '#586472';                    // --ds-fg-muted
const APPETITE = '#9a5007';                    // --ds-warning
const GRID = '#e1e6eb';                        // --ds-border
const W = 600;
const H = 150;
const PAD = 8;

export default function TrendChart({ trend }: { trend: TrendAnswer }) {
  const series = trend.series;
  const step = series.length > 1 ? (W - PAD * 2) / (series.length - 1) : 0;
  const x = (i: number) => PAD + i * step;
  const y = (v: number) => PAD + (1 - clamp100(v) / 100) * (H - PAD * 2);
  const note = trend.appetite != null ? `Solid: residual. Dashed: inherent. Amber: your appetite of ${trend.appetite}.` : 'Solid: residual. Dashed: inherent.';
  return (
    <>
      <ChartFrame title="Portfolio risk over 12 months" note={note} height={H} data={{ columns: ['Month', 'Residual', 'Inherent'], rows: series.map((s) => [monthWords(s.month), s.residual ?? '—', s.inherent ?? '—']) }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="none">
          {[25, 50, 75].map((g) => <line key={g} x1={PAD} x2={W - PAD} y1={y(g)} y2={y(g)} stroke={GRID} strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
          {trend.appetite != null && <line x1={PAD} x2={W - PAD} y1={y(trend.appetite)} y2={y(trend.appetite)} stroke={APPETITE} strokeWidth={1.5} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />}
          {runs(series.map((s) => s.inherent), x, y).map((points) => <polyline key={`i${points}`} points={points} fill="none" stroke={INHERENT} strokeWidth={2} strokeDasharray="5 4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />)}
          {runs(series.map((s) => s.residual), x, y).map((points) => <polyline key={`r${points}`} points={points} fill="none" stroke={RESIDUAL} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />)}
        </svg>
      </ChartFrame>
      <p className="m-0 mt-[4px] flex flex-wrap justify-between gap-x-[12px] text-ds-label text-ds-fg-muted">
        <span>{series.length ? monthWords(series[0].month) : ''}</span>
        <span>{series.length ? monthWords(series[series.length - 1].month) : ''}</span>
      </p>
    </>
  );
}
