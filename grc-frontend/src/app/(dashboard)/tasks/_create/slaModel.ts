// The SLA days New task fills in for a level, apart from React so `node --test` pins them (slaModel.test.ts). The organization's own numbers come first: the tenant's per-level target
// (Settings > SLA rules, `targets`), then its per-priority table (`by_priority`, the one the Settings tab shows); only when neither has the level does the number the platform shipped with (the
// per-browser SLA store the old form read first) apply. Their defaults are the same numbers (7, 30, 90, 180, 365), so a tenant that never changed anything sees no difference.
export type SlaLevel = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface SlaSettings { targets?: Record<string, { days?: number | null } | undefined> | null; by_priority?: Record<string, number | null | undefined> | null }

const whole = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 1;

/** The days for `level`: the tenant's target, else its per-priority table, else `fallback[level]`. */
export function slaDaysFor(sla: SlaSettings | null | undefined, level: SlaLevel, fallback: Record<SlaLevel, number>): number {
  const target = sla?.targets?.[level]?.days;
  if (whole(target)) return target;
  const priority = sla?.by_priority?.[level];
  if (whole(priority)) return priority;
  return fallback[level];
}
