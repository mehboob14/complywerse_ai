// What "a risk is over appetite" means, once, for the Risk Appetite page and every count that links to it. It is the Overview's definition (backend
// modules/erm/routers/dashboard.py, "Risk Appetite" section), which is why the Overview's own numbers do not change:
//   - the risks that count are ACTIVE (status is not "closed"; a missing status is "open") and SCORED (inherent and residual score both present)
//   - a risk's category is `Risk.category` (a missing one is "operational")
//   - a category has a LIMIT only when an appetite is configured for it: tolerance, else the maximum acceptable score, else 12
//   - a risk is OVER when its residual score is above its category's limit; a category with no appetite has no limit and nothing in it is over
// The Appetite page used to count closed risks and the other category column, and its breach list used 15 for a category with no appetite; Analytics had a third reading.
// Pure, `node --test src/lib/erm/breach.test.ts`.

export interface RiskRow {
  id: number;
  title: string;
  category?: string | null;
  status?: string | null;
  inherent_score?: number | null;
  residual_score?: number | null;
  owner_id?: number | null;
  owner_name?: string | null;
}

export interface AppetiteConfig {
  id: number;
  category: string;
  appetite_level: string;
  max_acceptable_score?: number | null;
  tolerance_threshold?: number | null;
  description?: string | null;
}

/** The limit when a configured category has neither a tolerance nor a maximum (the Overview's 12.0). */
export const FALLBACK_LIMIT = 12;

export const categoryOf = (r: Pick<RiskRow, 'category'>): string => r.category || 'operational';
export const isActive = (r: Pick<RiskRow, 'status'>): boolean => (r.status || 'open') !== 'closed';
const has = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
export const isScored = (r: Pick<RiskRow, 'inherent_score' | 'residual_score'>): boolean => has(r.inherent_score) && has(r.residual_score);

/** tolerance, else the maximum acceptable score, else 12 (a 0 falls through, as `or` does in the Overview). */
export const limitOf = (c: Pick<AppetiteConfig, 'tolerance_threshold' | 'max_acceptable_score'>): number => c.tolerance_threshold || c.max_acceptable_score || FALLBACK_LIMIT;

export interface Breach {
  risk: RiskRow;
  category: string;
  limit: number;
  score: number;
  /** how far above the limit */
  over: number;
}

/** Every risk that is over its category's limit, the furthest over first (ties by id, so the order never moves). */
export function breaches(risks: readonly RiskRow[], configs: readonly AppetiteConfig[]): Breach[] {
  const limits = new Map<string, number>();
  configs.forEach((c) => limits.set(c.category, limitOf(c)));
  const out: Breach[] = [];
  risks.forEach((risk) => {
    if (!isActive(risk) || !isScored(risk)) return;
    const category = categoryOf(risk);
    const limit = limits.get(category);
    const score = risk.residual_score as number;
    if (limit !== undefined && score > limit) out.push({ risk, category, limit, score, over: score - limit });
  });
  return out.sort((a, b) => b.over - a.over || a.risk.id - b.risk.id);
}

export interface CategoryExposure {
  category: string;
  config: AppetiteConfig | null;
  limit: number | null;
  /** active risks of the category */
  active: number;
  /** of those, scored */
  scored: number;
  over: number;
}

/**
 * One row per configured category and per category that has active risks, the configured ones first in the order of `configs`, then the rest by name. `over` is the
 * Overview's count for the category (0 for a category without an appetite).
 */
export function exposureByCategory(risks: readonly RiskRow[], configs: readonly AppetiteConfig[]): CategoryExposure[] {
  const rows = new Map<string, CategoryExposure>();
  configs.forEach((c) => rows.set(c.category, { category: c.category, config: c, limit: limitOf(c), active: 0, scored: 0, over: 0 }));
  const over = new Map<string, number>();
  breaches(risks, configs).forEach((b) => over.set(b.category, (over.get(b.category) ?? 0) + 1));
  risks.forEach((r) => {
    if (!isActive(r)) return;
    const category = categoryOf(r);
    const row = rows.get(category) ?? { category, config: null, limit: null, active: 0, scored: 0, over: 0 };
    row.active += 1;
    if (isScored(r)) row.scored += 1;
    rows.set(category, row);
  });
  over.forEach((n, category) => { const row = rows.get(category); if (row) row.over = n; });
  const configured = configs.map((c) => rows.get(c.category) as CategoryExposure);
  const rest = Array.from(rows.values()).filter((r) => !r.config).sort((a, b) => a.category.localeCompare(b.category));
  return configured.concat(rest);
}

/** The categories that have active risks and no appetite: the page's "without appetite" counter. */
export const unconfigured = (rows: readonly CategoryExposure[]): CategoryExposure[] => rows.filter((r) => !r.config && r.active > 0);
