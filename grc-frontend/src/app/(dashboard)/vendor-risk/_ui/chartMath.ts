// The arithmetic behind the tier ruler, the donut and the half gauge. Pure, so `node --test` runs chartMath.test.ts against it.

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** 0..100; anything that is not a number is 0. */
export const clampPercent = (n: number | null | undefined): number => (typeof n === 'number' && Number.isFinite(n) ? clamp(n, 0, 100) : 0);

// ---- the tier ruler ------------------------------------------------------------------------------------------------

export interface Thresholds { medium: number; high: number; critical: number }
export type RulerTier = 'low' | 'medium' | 'high' | 'critical';
export const RULER_ORDER: readonly RulerTier[] = ['low', 'medium', 'high', 'critical'];

/** Verity's shipped policy: Medium from 25, High from 50, Critical from 75. */
export const DEFAULT_THRESHOLDS: Thresholds = { medium: 25, high: 50, critical: 75 };

/** The scale's lower bounds, kept inside 0..100 and never going backwards (a policy saved out of order still draws). */
function bounds(t: Thresholds): [number, number, number] {
  const mid = clamp(Number.isFinite(t.medium) ? t.medium : DEFAULT_THRESHOLDS.medium, 0, 100);
  const high = clamp(Number.isFinite(t.high) ? t.high : DEFAULT_THRESHOLDS.high, mid, 100);
  const crit = clamp(Number.isFinite(t.critical) ? t.critical : DEFAULT_THRESHOLDS.critical, high, 100);
  return [mid, high, crit];
}

export interface RulerBand { tier: RulerTier; from: number; to: number; width: number }

/** Four bands, Low to Critical, each as wide as its range on the 0..100 axis. */
export function rulerBands(t: Thresholds): RulerBand[] {
  const edges = [0, ...bounds(t), 100];
  return RULER_ORDER.map((tier, i) => ({ tier, from: edges[i], to: edges[i + 1], width: edges[i + 1] - edges[i] }));
}

/** The tier a score falls in: a score on a line belongs to the higher tier. */
export function tierForScore(score: number, t: Thresholds): RulerTier {
  const [mid, high, crit] = bounds(t);
  return score >= crit ? 'critical' : score >= high ? 'high' : score >= mid ? 'medium' : 'low';
}

/** How far a score is below the next tier up ("3 points below High"); null at Critical or without a score. */
export function pointsToNext(score: number | null | undefined, t: Thresholds): { tier: RulerTier; points: number } | null {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  const at = tierForScore(score, t);
  const i = RULER_ORDER.indexOf(at);
  if (i === RULER_ORDER.length - 1) return null;
  const [mid, high, crit] = bounds(t);
  return { tier: RULER_ORDER[i + 1], points: Math.round(([mid, high, crit][i] - score) * 10) / 10 };
}

/** Where the score's marker sits on the axis, in percent; null without a score. */
export const markerPercent = (score: number | null | undefined): number | null =>
  typeof score === 'number' && Number.isFinite(score) ? clamp(score, 0, 100) : null;

// ---- the donut -----------------------------------------------------------------------------------------------------

export interface Arc { index: number; length: number; offset: number }

/** One dash per slice of a ring `circumference` long: how long it is and where it starts. A gap is left between neighbours (not
 *  around a lone slice); slices of nothing, or of less, are not drawn; no slices at all gives no arcs. */
export function donutArcs(values: number[], circumference: number, gap = 2): Arc[] {
  const clean = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = clean.reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  const drawn = clean.filter((v) => v > 0).length;
  const g = drawn > 1 ? gap : 0;
  let start = 0;
  const arcs: Arc[] = [];
  clean.forEach((v, index) => {
    if (v <= 0) return;
    const span = (v / total) * circumference;
    arcs.push({ index, length: Math.max(span - g, 0), offset: start });
    start += span;
  });
  return arcs;
}

// ---- the half gauge ------------------------------------------------------------------------------------------------

export type GaugeTone = 'danger' | 'warning' | 'success';

/** Red below 60, amber below 85, green from there: more is better. */
export const gaugeTone = (percent: number): GaugeTone => {
  const p = clampPercent(percent);
  return p < 60 ? 'danger' : p < 85 ? 'warning' : 'success';
};

export const GAUGE_ZONES: ReadonlyArray<{ tone: GaugeTone; to: number }> = [
  { tone: 'danger', to: 60 }, { tone: 'warning', to: 85 }, { tone: 'success', to: 100 },
];

/** The zones as dashes along a path of length 100, with `gap` between neighbours. */
export function gaugeSegments(gap = 1.5): Array<{ tone: GaugeTone; from: number; length: number }> {
  let from = 0;
  return GAUGE_ZONES.map((zone, i) => {
    const start = from + (i > 0 ? gap / 2 : 0);
    const end = zone.to - (i < GAUGE_ZONES.length - 1 ? gap / 2 : 0);
    from = zone.to;
    return { tone: zone.tone, from: start, length: end - start };
  });
}

/** Where the needle points: 0% is the left end of the arc, 100% the right end, 50% straight up (SVG y grows downwards). */
export function gaugePoint(percent: number, cx: number, cy: number, r: number): { x: number; y: number } {
  const angle = Math.PI * (1 - clampPercent(percent) / 100);
  return { x: cx + r * Math.cos(angle), y: cy - r * Math.sin(angle) };
}
