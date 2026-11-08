// The ONE score-band system of the Risk Management monitoring pages (heat map grid and tiles, aggregation, scenario, appetite). A score is likelihood x impact
// (1-25). The cut is the platform's: `risk_priority_for_score` in models/_11 and the Overview's docstring (dashboard.py): critical from 20, high from 12, medium from 6, else
// low. The older analytics code used 4 / 9 / 16 on the server and a third set on the heat-map grid; neither is used any more (G9 plan, section 5).
// Pure, so `node --test src/lib/erm/band.test.ts` pins it.

export type Band = 'critical' | 'high' | 'medium' | 'low';

/** Worst first. */
export const BANDS: readonly Band[] = ['critical', 'high', 'medium', 'low'];

/** The lowest score of each band but the last. */
export const BAND_FROM: Readonly<Record<Exclude<Band, 'low'>, number>> = { critical: 20, high: 12, medium: 6 };

export const BAND_LABEL: Readonly<Record<Band, string>> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

/** The scores a band covers on the 5 x 5 scale, said as the legend says them. */
export const BAND_RANGE: Readonly<Record<Band, string>> = { critical: '20–25', high: '12–19', medium: '6–11', low: '1–5' };

/** The band of a score; null when there is no score (nothing to rate: 0, empty and a non-number are "not scored"). */
export function scoreBand(score: number | null | undefined): Band | null {
  if (typeof score !== 'number' || !Number.isFinite(score) || score <= 0) return null;
  return score >= BAND_FROM.critical ? 'critical' : score >= BAND_FROM.high ? 'high' : score >= BAND_FROM.medium ? 'medium' : 'low';
}

/** How many of `scores` fall in each band, and how many have no score. */
export function bandCounts(scores: ReadonlyArray<number | null | undefined>): Record<Band, number> & { unscored: number } {
  const out = { critical: 0, high: 0, medium: 0, low: 0, unscored: 0 };
  scores.forEach((s) => {
    const band = scoreBand(s);
    if (band) out[band] += 1;
    else out.unscored += 1;
  });
  return out;
}
