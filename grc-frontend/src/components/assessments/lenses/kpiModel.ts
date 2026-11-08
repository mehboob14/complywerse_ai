// The KPI report lens: how the KPIs are ordered and counted. Pure (`node --test kpiModel.test.ts`). The KPI list comes from the uploaded workbook; the actual values are the live ones the
// platform computes where it owns the data (`buildKpis` in the dashboard's kpiShared overlays them); a KPI with no feed is "external" and shows no number.
import type { Kpi } from '../../dashboard/kpiShared.tsx';

export type KpiState = 'below' | 'on' | 'external';
/** Where a KPI stands: external when no module feeds it, else on or below its target (a live KPI with no target counts as on target, as the dashboard does). */
export const stateOf = (k: Pick<Kpi, 'live' | 'onTarget'>): KpiState => (!k.live ? 'external' : k.onTarget === false ? 'below' : 'on');

/** The ones that need a look first: below target, then on target, then external; by domain inside each. */
export function orderKpis<T extends Pick<Kpi, 'live' | 'onTarget' | 'domain'>>(kpis: readonly T[]): T[] {
  const rank = (k: T): number => (!k.live ? 2 : k.onTarget === false ? 0 : 1);
  return kpis.slice().sort((a, b) => rank(a) - rank(b) || a.domain.localeCompare(b.domain));
}

export interface KpiCounts { total: number; live: number; onTarget: number; below: number; external: number; domains: number }
export function countKpis(kpis: readonly Pick<Kpi, 'live' | 'onTarget' | 'domain'>[]): KpiCounts {
  const live = kpis.filter((k) => k.live);
  return {
    total: kpis.length, live: live.length, onTarget: live.filter((k) => k.onTarget).length, below: live.filter((k) => k.onTarget === false).length,
    external: kpis.length - live.length, domains: new Set(kpis.map((k) => k.domain)).size,
  };
}

/** The remarks of a KPI added by hand: "Def: how it is measured | Source: where it comes from" (what the workbook parser writes, and what the catalogue reads back). */
export function kpiRemarks(definition: string, source: string): string {
  return [definition.trim() ? `Def: ${definition.trim()}` : '', source.trim() ? `Source: ${source.trim()}` : ''].filter(Boolean).join(' | ');
}
