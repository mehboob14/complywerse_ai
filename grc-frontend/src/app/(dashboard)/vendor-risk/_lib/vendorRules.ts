// The module's two definitions that every page shares (vendor-shell, 2026-11-08). Pure, so `node --test` runs vendorRules.test.ts against it.
//
// 1. The BANDS of a residual score. Tiers are set by the tenant's thresholds (Setup > Policy; GET /vendor-risk/policy `thresholds`), shipped at 75 / 50 / 25 on a 0..100 scale: critical
//    from 75, high from 50, medium from 25, low below. A residual score is coloured and worded on the SAME bands, so a vendor cannot be "High" by tier and "Critical" by colour. The
//    pages used 70 / 48 / 26 for the colour until now (tprmShared.scoreColor). A page that has the tenant's thresholds passes them; one that has not yet read them uses the shipped ones.
// 2. What OVERDUE means. A vendor's reassessment is overdue when the EARLIER of its own reassessment date and the dates of its engagements is before today, for a vendor in use (not
//    retired, inactive, terminated, a request nobody picked up or an archived one). The server decides it (`attention_counts.reassessment_overdue`, `next_action.code`): a page never
//    counts it again from the dates it happens to hold. `isBeforeToday` is for the date shown in a row (a past date is red), judged on the calendar day in UTC, the server's.

export interface Bands { critical: number; high: number; medium: number }

/** What a tenant that never changed its policy has. */
export const SHIPPED_BANDS: Readonly<Bands> = { critical: 75, high: 50, medium: 25 };

export type Band = 'critical' | 'high' | 'medium' | 'low' | 'none';

/** The tenant's bands from the policy payload; the shipped ones when it is missing or does not fall (critical above high above medium above 0). */
export function bandsFrom(policy?: { thresholds?: Partial<Record<keyof Bands, unknown>> } | null): Bands {
  const t = policy?.thresholds;
  const [critical, high, medium] = [t?.critical, t?.high, t?.medium];
  const ok = [critical, high, medium].every((n) => typeof n === 'number' && Number.isFinite(n))
    && (critical as number) > (high as number) && (high as number) > (medium as number) && (medium as number) > 0 && (critical as number) <= 100;
  return ok ? { critical: critical as number, high: high as number, medium: medium as number } : { ...SHIPPED_BANDS };
}

/** The band of a residual score: 'none' when it has none. */
export function residualBand(score: number | null | undefined, bands: Bands = SHIPPED_BANDS): Band {
  if (typeof score !== 'number' || !Number.isFinite(score)) return 'none';
  if (score >= bands.critical) return 'critical';
  if (score >= bands.high) return 'high';
  if (score >= bands.medium) return 'medium';
  return 'low';
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Today's calendar day in UTC, "2026-11-08". */
export const utcDay = (now: Date = new Date()): string => `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;

/** Whether a stored date (a day, or a moment: its first ten characters are the day) is before today's calendar day. Nothing recorded is not overdue. */
export function isBeforeToday(value: string | null | undefined, now: Date = new Date()): boolean {
  const day = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : '';
  return day !== '' && day < utcDay(now);
}
