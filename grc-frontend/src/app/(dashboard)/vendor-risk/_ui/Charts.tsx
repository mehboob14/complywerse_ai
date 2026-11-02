'use client';

// Three small SVG/CSS charts, drawn here because the pages need them at a glance, not as analysis: the tier ruler, a donut with
// its legend, and a half gauge. No chart library; the arithmetic is chartMath.ts (tested). Explicit hex: the platform CSS repaints
// slate/white utilities inside the shell.
import Link from 'next/link';
import { clsx } from 'clsx';
import { SEV_HEX } from '../_lib/tprmShared';
import {
  clampPercent, donutArcs, gaugePoint, gaugeSegments, gaugeTone, markerPercent, pointsToNext, rulerBands, tierForScore, type Thresholds,
} from './chartMath';
import { onColor, tierLabel } from './tiers';
import { TONE } from './tones';

const num = (n: number): string => String(Math.round(n * 10) / 10);

/** The tier scale: four bands as wide as the policy's ranges, Low to Critical, with the score pinned above and the numbers below.
 *  `showNext` adds "3 points below High". `compact` is the small one for a dialog or a card. */
export function ThresholdRuler({ score, thresholds, compact = false, showNext = false }: {
  score?: number | null;
  /** the lower bound of each tier above Low, from the policy */
  thresholds: Thresholds;
  compact?: boolean;
  showNext?: boolean;
}) {
  const bands = rulerBands(thresholds);
  const marker = markerPercent(score);
  const next = showNext ? pointsToNext(score, thresholds) : null;
  const scored = typeof score === 'number' && Number.isFinite(score);
  const tier = scored ? tierLabel(tierForScore(score, thresholds)) : null;
  const pinText = scored ? num(score) : '';
  const half = Math.ceil(pinText.length * 3.5 + 6);              // half the chip's width, from its digits
  return (
    <div className="w-full">
      {/* the pin row is kept without a score so the bar does not jump when the first score arrives. The chip is kept inside the bar's
          width (a score near 0 or 100 would hang out of a card and widen a phone's page); the pointer stays on the exact score */}
      <div aria-hidden className={clsx('relative', compact ? 'mb-0.5 h-6' : 'mb-1 h-7')}>
        {marker !== null && scored && (
          <>
            <span
              className="absolute bottom-[5px] -translate-x-1/2 whitespace-nowrap rounded bg-[#1f2933] px-1.5 py-1 text-[11px] font-bold leading-none tabular-nums text-[#fff]"
              style={{ left: `clamp(${half}px, ${marker}%, calc(100% - ${half}px))` }}
            >
              {pinText}
            </span>
            <span className="absolute bottom-0 h-0 w-0 -translate-x-1/2 border-x-[5px] border-t-[5px] border-x-transparent border-t-[#1f2933]" style={{ left: `${marker}%` }} />
          </>
        )}
      </div>
      <div
        role="img"
        aria-label={scored ? `Score ${pinText} of 100, ${tier} tier` : `Tier scale: ${bands.map((b) => `${tierLabel(b.tier)} from ${b.from}`).join(', ')}`}
        className={clsx('flex gap-0.5 overflow-hidden rounded-md', compact ? 'h-6' : 'h-8')}
      >
        {bands.filter((b) => b.width > 0).map((b) => (
          <span
            key={b.tier}
            className="flex min-w-0 items-center justify-center px-1"
            style={{ flexGrow: b.width, flexBasis: 0, background: SEV_HEX[b.tier], color: onColor(SEV_HEX[b.tier]) }}
          >
            <span className={clsx('truncate font-bold', compact ? 'text-[10px]' : 'text-[11px]')}>{tierLabel(b.tier)}</span>
          </span>
        ))}
      </div>
      <div aria-hidden className="relative mt-1 h-4 text-[11px] leading-4 tabular-nums text-[#64707e]">
        {bands.map((b, i) => (
          <span key={b.tier} className={clsx('absolute', i > 0 && '-translate-x-1/2')} style={{ left: `${b.from}%` }}>{num(b.from)}</span>
        ))}
        <span className="absolute right-0">100</span>
      </div>
      {next && (
        <p className="mt-1 text-[12px] leading-4 text-[#586472]">
          <span className="font-semibold tabular-nums text-[#1f2933]">{num(next.points)}</span> points below {tierLabel(next.tier)}
        </p>
      )}
    </div>
  );
}

/** A ring split into slices with the total in the middle, and a legend above it whose entries link when a slice has an `href`.
 *  Pass only the slices worth showing (a slice of 0 draws nothing); with nothing to draw it says `emptyText`. */
export function Donut({ slices, centerValue, centerLabel, size = 152, emptyText = 'No data yet' }: {
  slices: Array<{ key: string; label: string; value: number; color: string; href?: string }>;
  centerValue?: string | number;
  centerLabel?: string;
  size?: number;
  emptyText?: string;
}) {
  const total = slices.reduce((n, s) => n + (Number.isFinite(s.value) && s.value > 0 ? s.value : 0), 0);
  if (total <= 0) return <p className="py-8 text-center text-[13px] leading-5 text-[#64707e]">{emptyText}</p>;

  const thickness = Math.round(size * 0.12);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const mid = size / 2;
  const arcs = donutArcs(slices.map((s) => s.value), c);
  return (
    <div className="flex flex-col items-center gap-4">
      <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
        {slices.map((s) => {
          const body = (
            <>
              <span aria-hidden className="h-2.5 w-5 shrink-0 rounded-sm" style={{ background: s.color }} />
              <span className="text-[#586472]">{s.label}</span>
              <span className="font-semibold tabular-nums text-[#1f2933]">{s.value}</span>
            </>
          );
          return (
            <li key={s.key} className="text-[12px] leading-4">
              {s.href ? (
                <Link href={s.href} className="flex items-center gap-1.5 rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]">{body}</Link>
              ) : (
                <span className="flex items-center gap-1.5">{body}</span>
              )}
            </li>
          );
        })}
      </ul>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${centerValue != null ? `${centerLabel ?? 'Total'} ${centerValue}: ` : ''}${slices.map((s) => `${s.label} ${s.value}`).join(', ')}`}
        className="max-w-full shrink-0"
      >
        <circle cx={mid} cy={mid} r={r} fill="none" stroke="#eef1f4" strokeWidth={thickness} />
        {arcs.map((a) => {
          const s = slices[a.index];
          return (
            <circle
              key={s.key}
              cx={mid}
              cy={mid}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeDasharray={`${a.length} ${Math.max(c - a.length, 0)}`}
              strokeDashoffset={-a.offset}
              transform={`rotate(-90 ${mid} ${mid})`}
            >
              <title>{`${s.label}: ${s.value} (${Math.round((s.value / total) * 100)}%)`}</title>
            </circle>
          );
        })}
        {centerValue != null && (
          <text x={mid} y={centerLabel ? mid - size * 0.03 : mid} textAnchor="middle" dominantBaseline="middle" fill="#1f2933" fontWeight={700} style={{ fontSize: size * 0.22 }}>
            {centerValue}
          </text>
        )}
        {centerValue != null && centerLabel && (
          <text x={mid} y={mid + size * 0.14} textAnchor="middle" dominantBaseline="middle" fill="#586472" style={{ fontSize: Math.max(11, size * 0.075) }}>
            {centerLabel}
          </text>
        )}
      </svg>
    </div>
  );
}

/** A half-circle gauge for "how much is in good order": red below 60, amber below 85, green from there. The big number takes the
 *  colour of the zone the needle is in. */
export function HalfGauge({ percent, label, caption }: { percent: number; label?: string; caption?: string }) {
  const p = clampPercent(percent);
  const tone = gaugeTone(p);
  const width = 176;
  const thickness = 14;
  const r = width / 2 - thickness;
  const cx = width / 2;
  const cy = width / 2 - thickness / 2;
  const needle = gaugePoint(p, cx, cy, r - thickness * 0.4);
  return (
    <div className="flex flex-col items-center">
      <svg
        width={width}
        height={cy + thickness + 4}
        viewBox={`0 0 ${width} ${cy + thickness + 4}`}
        role="img"
        aria-label={`${label ?? 'Coverage'} ${Math.round(p)}%`}
        className="max-w-full"
      >
        {gaugeSegments().map((z) => (
          <path
            key={z.tone}
            d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
            fill="none"
            stroke={TONE[z.tone].dot}
            strokeWidth={thickness}
            pathLength={100}
            strokeDasharray={`${z.length} ${100 - z.length}`}
            strokeDashoffset={-z.from}
          />
        ))}
        <line x1={cx} y1={cy} x2={needle.x} y2={needle.y} stroke="#1f2933" strokeWidth={2.5} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={4} fill="#1f2933" />
        <text x={cx - r} y={cy + 15} textAnchor="start" fill="#64707e" style={{ fontSize: 10 }}>0%</text>
        <text x={cx + r} y={cy + 15} textAnchor="end" fill="#64707e" style={{ fontSize: 10 }}>100%</text>
      </svg>
      <span className="mt-1 text-[28px] font-semibold leading-8 tabular-nums" style={{ color: TONE[tone].text }}>{Math.round(p)}%</span>
      {label && <span className="text-[12px] leading-4 text-[#586472]">{label}</span>}
      {caption && <span className="mt-1 text-[13px] font-medium leading-5 text-[#26323d]">{caption}</span>}
    </div>
  );
}
