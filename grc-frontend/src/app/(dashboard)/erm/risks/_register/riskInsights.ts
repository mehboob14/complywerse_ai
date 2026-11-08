// The numbers of the register's Insights view (the old Risk Register dashboard, folded in), computed from the rows the person is looking at, apart from React so `node --test`
// pins them (riskInsights.test.ts) against the rules of the server's dashboards (`/erm/risks/dashboard/by-register`, `/by-source`, `/heatmap`). One function for each number;
// nothing here is read from a screen.
import {
  BUCKET_LABEL, STATUS_BUCKETS, bandOf, categoryKey, levelScore, matrixOf, statusBucket,
  type Band, type Basis, type RiskRow, type StatusBucket,
} from './riskModel.ts';

export const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'] as const;

export interface SeverityCounts { critical: number; high: number; medium: number; low: number; none: number; scored: number }

/** Risks per band, by the residual score, else the inherent (the server's `residual_score or inherent_score or 0`). `none` is the risks with no score: the server counted them
 *  in "low" (its `else`), so `low + none` is the old dashboard's Low. `scored` is the four bands together. */
export function severityCounts(rows: readonly RiskRow[]): SeverityCounts {
  const out: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0, none: 0, scored: 0 };
  rows.forEach((r) => {
    const b: Band = bandOf(levelScore(r));
    out[b] += 1;
    if (b !== 'none') out.scored += 1;
  });
  return out;
}

export type StatusCounts = Record<StatusBucket, number>;
export function statusCounts(rows: readonly RiskRow[]): StatusCounts {
  const out = { open: 0, in_treatment: 0, mitigated: 0, accepted: 0, closed: 0 } as StatusCounts;
  rows.forEach((r) => { out[statusBucket(r.status)] += 1; });
  return out;
}

export const STANDARD_REGISTER = 'Standard';

export interface RegisterBreakdown {
  register: string;
  total: number;
  status: StatusCounts;
  severity: SeverityCounts;
  /** the mean of the residual scores that exist, to two decimals; 0 when none (the server's `avg_residual_score`) */
  avgResidual: number;
  /** distinct people holding a risk of the register */
  people: number;
}

/** One entry per register type (no type: "Standard"), biggest first, as `/dashboard/by-register` lists them. */
export function byRegister(rows: readonly RiskRow[]): RegisterBreakdown[] {
  const groups = new Map<string, RiskRow[]>();
  rows.forEach((r) => {
    const key = (r.register_type || '').trim() || STANDARD_REGISTER;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  });
  const out: RegisterBreakdown[] = Array.from(groups, ([register, list]) => {
    const residual = list.filter((r) => r.residual_score).map((r) => Number(r.residual_score));
    const people = new Set<number>();
    list.forEach((r) => { if (r.owner_id != null) people.add(r.owner_id); if (r.business_owner_id != null) people.add(r.business_owner_id); });
    return {
      register, total: list.length, status: statusCounts(list), severity: severityCounts(list),
      avgResidual: residual.length ? Math.round((residual.reduce((a, b) => a + b, 0) / residual.length) * 100) / 100 : 0, people: people.size,
    };
  });
  return out.sort((a, b) => b.total - a.total || a.register.localeCompare(b.register));
}

/** Where a risk came from: the source it states, else what its register type and assessments say (`_infer_source_type` of the server). */
export function sourceOf(r: Pick<RiskRow, 'source_type' | 'register_type' | 'in_assessment'>): string {
  const explicit = (r.source_type || '').trim();
  if (explicit) return explicit;
  const rt = (r.register_type || '').trim().toLowerCase();
  if (['ubl template', 'ubltemplate', 'ubl'].includes(rt)) return 'ubl_import';
  if (['nca template', 'ncatemplate', 'nca'].includes(rt)) return 'nca_import';
  if (r.in_assessment) return 'assessment';
  if (rt) return 'register_import';
  return 'manual';
}

export interface SourceBreakdown { source: string; total: number; status: StatusCounts }
export function bySource(rows: readonly RiskRow[]): SourceBreakdown[] {
  const groups = new Map<string, RiskRow[]>();
  rows.forEach((r) => { const k = sourceOf(r); groups.set(k, [...(groups.get(k) ?? []), r]); });
  return Array.from(groups, ([source, list]) => ({ source, total: list.length, status: statusCounts(list) })).sort((a, b) => b.total - a.total || a.source.localeCompare(b.source));
}

export interface CategoryCount { key: string; total: number }
export function byCategory(rows: readonly RiskRow[]): CategoryCount[] {
  const m = new Map<string, number>();
  rows.forEach((r) => { const k = categoryKey(r); m.set(k, (m.get(k) ?? 0) + 1); });
  return Array.from(m, ([key, total]) => ({ key, total })).sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
}

/** Risks per person (a risk counts once for each of its people: its risk owner and its business owner), most first. */
export function workload(rows: readonly RiskRow[]): { id: number; name: string; total: number }[] {
  const m = new Map<number, { name: string; total: number }>();
  rows.forEach((r) => {
    const mine: [number | null | undefined, string | null | undefined][] = [[r.owner_id, r.owner_name], [r.business_owner_id, r.business_owner_name]];
    const seen = new Set<number>();
    mine.forEach(([id, name]) => {
      if (id == null || seen.has(id)) return;
      seen.add(id);
      const cur = m.get(id) ?? { name: name || 'Someone no longer here', total: 0 };
      m.set(id, { name: cur.name, total: cur.total + 1 });
    });
  });
  return Array.from(m, ([id, v]) => ({ id, ...v })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

/** The 5x5 matrix as rows of cells (likelihood 5 at the top down to 1; impact 1 at the left to 5), each with its count: the cells of `GET /erm/risks/heatmap`. */
export interface MatrixCell { l: number; i: number; count: number }
export function matrixRows(rows: readonly RiskRow[], basis: Basis): MatrixCell[][] {
  const counts = matrixOf(rows, basis);
  return [5, 4, 3, 2, 1].map((l) => [1, 2, 3, 4, 5].map((i) => ({ l, i, count: counts.get(`${l}-${i}`) ?? 0 })));
}

/** How many risks the matrix places (both a likelihood and an impact). */
export const placedCount = (cells: readonly MatrixCell[][]): number => cells.reduce((n, row) => n + row.reduce((m, c) => m + c.count, 0), 0);

export { BUCKET_LABEL, STATUS_BUCKETS };
