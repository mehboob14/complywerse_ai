'use client';

// The tier scale: four bands as wide as the policy's ranges, Low to Critical, with the score pinned above and the numbers below ("3 points below High" with `showNext`). The same arithmetic as
// the vendor module's older ruler (_ui/chartMath.ts, tested), drawn with nothing under 12px and the kit's tokens; the band colours are the tier ramp (SEV_HEX), which is data, not chrome.
import { clsx } from 'clsx';
import { SEV_HEX } from '../../../_lib/tprmShared';
import { markerPercent, pointsToNext, rulerBands, tierForScore, type Thresholds } from '../../../_ui/chartMath';
import { onColor, tierLabel } from '../../../_ui/tiers';

const num = (n: number): string => String(Math.round(n * 10) / 10);

export default function RecordRuler({ score, thresholds, compact = false, showNext = false }: {
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
      {/* the pin row is kept without a score so the bar does not jump when the first score arrives; the chip stays inside the bar's width, the pointer on the exact score */}
      <div aria-hidden className={clsx('relative', compact ? 'mb-[2px] h-[24px]' : 'mb-[4px] h-[28px]')}>
        {marker !== null && scored && (
          <>
            <span
              className="absolute bottom-[5px] -translate-x-1/2 whitespace-nowrap rounded-ds-control bg-ds-fg px-[6px] py-[4px] text-[12px] font-[700] leading-none tabular-nums text-ds-on-primary"
              style={{ left: `clamp(${half}px, ${marker}%, calc(100% - ${half}px))` }}
            >
              {pinText}
            </span>
            <span className="absolute bottom-0 h-0 w-0 -translate-x-1/2 border-x-[5px] border-t-[5px] border-x-transparent border-t-ds-fg" style={{ left: `${marker}%` }} />
          </>
        )}
      </div>
      <div
        role="img"
        aria-label={scored ? `Score ${pinText} of 100, ${tier} tier` : `Tier scale: ${bands.map((b) => `${tierLabel(b.tier)} from ${b.from}`).join(', ')}`}
        className={clsx('flex gap-[2px] overflow-hidden rounded-ds-control', compact ? 'h-[24px]' : 'h-[32px]')}
      >
        {bands.filter((b) => b.width > 0).map((b) => (
          <span key={b.tier} className="flex min-w-0 items-center justify-center px-[4px]" style={{ flexGrow: b.width, flexBasis: 0, background: SEV_HEX[b.tier], color: onColor(SEV_HEX[b.tier]) }}>
            <span className="truncate text-[12px] font-[700]">{tierLabel(b.tier)}</span>
          </span>
        ))}
      </div>
      <div aria-hidden className="relative mt-[4px] h-[16px] text-[12px] leading-4 tabular-nums text-ds-fg-muted">
        {bands.map((b, i) => (
          <span key={b.tier} className={clsx('absolute', i > 0 && '-translate-x-1/2')} style={{ left: `${b.from}%` }}>{num(b.from)}</span>
        ))}
        <span className="absolute right-0">100</span>
      </div>
      {next && (
        <p className="mt-[4px] text-[12px] leading-4 text-ds-fg-muted">
          <span className="font-[600] tabular-nums text-ds-fg">{num(next.points)}</span> points below {tierLabel(next.tier)}
        </p>
      )}
    </div>
  );
}
