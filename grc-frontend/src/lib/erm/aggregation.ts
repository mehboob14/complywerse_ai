// Risk aggregation, apart from React (`node --test src/lib/erm/aggregation.test.ts`). It reproduces the numbers of backend modules/erm/routers/advanced_analytics.py
// `get_risk_aggregation` (which risks count, the totals, the averages to one decimal, the reduction, the groups and their order) from the lean risk list, so the page reads the
// whole register in one request. ONE thing differs on purpose: the Critical / High / Medium / Low counts use the platform's score bands (lib/erm/band.ts: 20 / 12 / 6) instead of
// the server's 16 / 9 / 4, and a risk with no residual score is counted as "not scored", not as Low (a 0 is not a low risk, it is a missing one).
import { scoreBand, type Band } from './band.ts';

export interface AggRisk {
  id: number;
  risk_category?: string | null;
  status?: string | null;
  closure_status?: string | null;
  inherent_score?: number | null;
  residual_score?: number | null;
  business_unit_id?: number | null;
  business_unit?: string | null;
}

export type BandCounts = Record<Band, number> & { unscored: number };
const noBands = (): BandCounts => ({ critical: 0, high: 0, medium: 0, low: 0, unscored: 0 });
const round1 = (n: number): number => Math.round(n * 10) / 10;
const n0 = (v: number | null | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export interface AggGroup extends BandCounts {
  key: string;
  label: string;
  count: number;
  totalInherent: number;
  totalResidual: number;
  avgInherent: number;
  avgResidual: number;
  reductionPct: number;
}

export interface Aggregation {
  summary: BandCounts & {
    totalRisks: number; totalInherent: number; totalResidual: number; avgInherent: number; avgResidual: number; reductionPct: number;
  };
  byCategory: AggGroup[];
  byBusinessUnit: AggGroup[];
  byStatus: Array<{ status: string; count: number; avgScore: number }>;
}

const reduction = (inherent: number, residual: number): number => (inherent > 0 ? round1(((inherent - residual) / inherent) * 100) : 0);

function group(rows: readonly AggRisk[], keyOf: (r: AggRisk) => string, labelOf: (r: AggRisk) => string): AggGroup[] {
  const map = new Map<string, AggGroup>();
  rows.forEach((r) => {
    const key = keyOf(r);
    const g = map.get(key) ?? { key, label: labelOf(r), count: 0, totalInherent: 0, totalResidual: 0, avgInherent: 0, avgResidual: 0, reductionPct: 0, ...noBands() };
    g.count += 1;
    g.totalInherent += n0(r.inherent_score);
    g.totalResidual += n0(r.residual_score);
    const band = scoreBand(r.residual_score);
    g[band ?? 'unscored'] += 1;
    map.set(key, g);
  });
  return Array.from(map.values())
    .map((g) => ({ ...g, avgInherent: round1(g.totalInherent / g.count), avgResidual: round1(g.totalResidual / g.count), reductionPct: reduction(g.totalInherent, g.totalResidual) }))
    .sort((a, b) => b.totalResidual - a.totalResidual || a.label.localeCompare(b.label));         // the server's order: most residual exposure first
}

export function aggregate(risks: readonly AggRisk[]): Aggregation {
  const live = risks.filter((r) => !r.closure_status);                                       // closure_status IS NULL, as the server filters
  const totalInherent = live.reduce((n, r) => n + n0(r.inherent_score), 0);
  const totalResidual = live.reduce((n, r) => n + n0(r.residual_score), 0);
  const bands = noBands();
  live.forEach((r) => { bands[scoreBand(r.residual_score) ?? 'unscored'] += 1; });
  const statuses = new Map<string, { status: string; count: number; total: number }>();
  live.forEach((r) => {
    const status = r.status || 'open';
    const s = statuses.get(status) ?? { status, count: 0, total: 0 };
    s.count += 1;
    s.total += n0(r.residual_score);
    statuses.set(status, s);
  });
  return {
    summary: {
      totalRisks: live.length,
      totalInherent: round1(totalInherent),
      totalResidual: round1(totalResidual),
      avgInherent: live.length ? round1(totalInherent / live.length) : 0,
      avgResidual: live.length ? round1(totalResidual / live.length) : 0,
      reductionPct: reduction(totalInherent, totalResidual),
      ...bands,
    },
    byCategory: group(live, (r) => r.risk_category || 'uncategorized', (r) => r.risk_category || 'uncategorized'),
    byBusinessUnit: group(live, (r) => String(r.business_unit_id || 0), (r) => r.business_unit || 'Unassigned'),
    byStatus: Array.from(statuses.values()).map((s) => ({ status: s.status, count: s.count, avgScore: round1(s.total / s.count) })),
  };
}
