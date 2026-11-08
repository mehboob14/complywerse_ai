// The heat map's numbers, apart from React (`node --test src/lib/erm/heat.test.ts`). The server (advanced_analytics.py `get_interactive_heatmap`) sends 25 cells
// (likelihood x impact, with the risks in each) and `total_risks`, which counts EVERY open risk, scored or not. The tiles used their own bands (>16, 9-16, 4-9, <=4) while the
// grid coloured by a third set (>=17, >=10, >=5), so a cell and the tile above it disagreed; both now use lib/erm/band.ts, and "not scored" is its own number.
import { BANDS, scoreBand, type Band } from './band.ts';

export interface HeatRisk { id: number; title: string; category?: string | null; status?: string | null; owner?: string | null; business_unit?: string | null; inherent_score?: number | null; residual_score?: number | null }
export interface HeatCell { likelihood: number; impact: number; score: number; count: number; risks: HeatRisk[] }
export interface HeatResponse { cells: HeatCell[]; total_risks: number; max_count: number; likelihood_labels: string[]; impact_labels: string[] }

export interface HeatTiles {
  /** risks placed on the grid */
  scored: number;
  /** open risks with no likelihood and impact for the chosen score type */
  unscored: number;
  /** every open risk the server counted */
  total: number;
  bands: Record<Band, number>;
}

export function heatTiles(data: Pick<HeatResponse, 'cells' | 'total_risks'> | undefined): HeatTiles {
  const bands: Record<Band, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  let scored = 0;
  (data?.cells ?? []).forEach((c) => {
    const band = scoreBand(c.score);
    if (band) bands[band] += c.count;
    scored += c.count;
  });
  const total = data?.total_risks ?? scored;
  return { scored, unscored: Math.max(0, total - scored), total, bands };
}

/** The cells that hold a risk, worst score first (the list a screen reader and the list view read). */
export function occupied(cells: readonly HeatCell[]): HeatCell[] {
  return cells.filter((c) => c.count > 0).sort((a, b) => b.score - a.score || b.impact - a.impact);
}

export const cellBand = (c: Pick<HeatCell, 'score'>): Band => scoreBand(c.score) ?? 'low';

/** "Likelihood 4 (Likely), impact 3 (Moderate): score 12, High, 3 risks" - the cell's name for a screen reader and its tooltip. */
export function cellWords(c: HeatCell, likelihoodLabels: readonly string[], impactLabels: readonly string[]): string {
  const l = likelihoodLabels[c.likelihood - 1];
  const i = impactLabels[c.impact - 1];
  const band = cellBand(c);
  return `Likelihood ${c.likelihood}${l ? ` (${l})` : ''}, impact ${c.impact}${i ? ` (${i})` : ''}: score ${c.score}, ${band}, ${c.count} ${c.count === 1 ? 'risk' : 'risks'}`;
}

export const BAND_ORDER = BANDS;
