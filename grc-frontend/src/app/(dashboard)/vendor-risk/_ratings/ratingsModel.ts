// The Security ratings register's definition (facets, quick chips, sorts), apart from React (`ratingsModel.test.ts`). The rows are `GET /vendor-risk/outside-in`: every supplier with how its websites
// and domains look from outside. The score, the grade, the average and the counts are the SERVER's (tpra/outside_in.py, monitoring_policy.py: score = 100 minus the points of the worst open
// findings, HIGHER is better); this file never recomputes them, it only filters and orders what came. The scale is named in every word (an outside-in B is not an assessment's grade B).
import { buildSchema, type RegisterDef } from '../../../../components/records/registerModel.ts';
import { GRADE_ORDER, outsideInGrade } from '../../../../lib/statuses/vendorMonitoring.ts';

export interface RatingPoint { at: string; score: number; grade?: string | null; risks?: Record<string, number> | null }

export interface RatingRow {
  vendor: { id: number; name: string; tier: string | null };
  domains: string[];
  score: number | null;
  grade: string | null;
  change: number | null;
  scanned_at: string | null;
  serious: number;
  waived: number;
  ratings: Record<string, RatingPoint>;
}

export interface Waiver { id: number; finding_key: string; host: string | null; expires_on: string; days_left: number; vendor: { id: number; name: string } }

export interface RatingsAnswer {
  items: RatingRow[];
  grades: Record<string, number>;
  average: number | null;
  unscanned: number;
  no_domain: number;
  expiring_waivers: Waiver[];
  enabled: boolean;
  shodan: boolean;
  every_days: Record<string, number>;
  grade_bands?: Record<string, number>;
}

const NONE = 'none';

export const gradeOf = (r: Pick<RatingRow, 'grade'>): string => (r.grade ? r.grade.toUpperCase() : NONE);
/** Graded D or F: the number the page has always called "Graded D or F" (the server's `grades.D + grades.F`). */
export const isWeak = (r: Pick<RatingRow, 'grade'>): boolean => gradeOf(r) === 'D' || gradeOf(r) === 'F';
/** Has a domain and has never been scored: the server's `unscanned`. */
export const isUnscanned = (r: Pick<RatingRow, 'score' | 'domains'>): boolean => r.score === null && r.domains.length > 0;
export const hasNoDomain = (r: Pick<RatingRow, 'domains'>): boolean => r.domains.length === 0;
export const scanState = (r: Pick<RatingRow, 'score' | 'domains'>): 'scanned' | 'unscanned' | 'no_domain' => (hasNoDomain(r) ? 'no_domain' : isUnscanned(r) ? 'unscanned' : 'scanned');
export const moved = (r: Pick<RatingRow, 'change'>): 'dropped' | 'rose' | 'same' => (!r.change ? 'same' : r.change < 0 ? 'dropped' : 'rose');

/** "1 critical · 3 high" for a provider's own count of risks, worst first; null when it sent none. */
export function riskCounts(risks?: Record<string, number> | null): string | null {
  if (!risks) return null;
  const shown = ['critical', 'high', 'medium', 'low'].filter((s) => risks[s]).map((s) => `${risks[s]} ${s}`);
  return shown.length ? shown.join(' · ') : 'no open risks';
}

/** The providers that sent a rating for any supplier, by name. */
export const providersOf = (rows: readonly RatingRow[]): string[] => Array.from(new Set(rows.flatMap((r) => Object.keys(r.ratings)))).sort();

/** "weekly", "monthly", "quarterly": how often a tier is scanned, in words. */
export const everyWords = (d: number): string =>
  d === 1 ? 'daily' : d === 7 ? 'weekly' : d === 30 ? 'monthly' : d === 90 ? 'quarterly' : d === 180 ? 'twice a year' : d === 365 ? 'yearly' : `every ${d} days`;

const TIERS = ['critical', 'high', 'medium', 'low'];

export function ratingsDef(): RegisterDef<RatingRow> {
  return {
    key: 'rating',
    noun: { one: 'supplier', other: 'suppliers' },
    idOf: (r) => r.vendor.id,
    text: (r) => [r.vendor.name, ...r.domains].join(' '),
    facets: [
      { key: 'grade', label: 'Outside-in grade', defaultOpen: true, values: (r) => [gradeOf(r)], options: () => [...GRADE_ORDER, NONE].map((value) => ({ value, label: outsideInGrade.label(value) })) },
      {
        key: 'tier', label: 'Supplier tier', defaultOpen: true, values: (r) => [r.vendor.tier ? r.vendor.tier.toLowerCase() : NONE],
        options: () => [...TIERS.map((value) => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) })), { value: NONE, label: 'Not tiered' }],
      },
      { key: 'scan', label: 'Scan', values: (r) => [scanState(r)], options: () => [{ value: 'scanned', label: 'Scanned' }, { value: 'unscanned', label: 'Not scanned yet' }, { value: 'no_domain', label: 'No domain on record' }] },
      { key: 'move', label: 'Since the last scan', values: (r) => [moved(r)], options: () => [{ value: 'dropped', label: 'Score fell' }, { value: 'rose', label: 'Score rose' }, { value: 'same', label: 'No change' }] },
      { key: 'serious', label: 'High or critical findings', values: (r) => [r.serious > 0 ? 'has' : 'none'], options: () => [{ value: 'has', label: 'Has some' }, { value: 'none', label: 'None' }] },
      { key: 'waiver', label: 'Waivers', values: (r) => [r.waived > 0 ? 'has' : 'none'], options: () => [{ value: 'has', label: 'Has waived findings' }, { value: 'none', label: 'None' }] },
    ],
    quick: [
      { key: 'weak', label: 'Graded D or F', test: (r) => isWeak(r), title: 'The weakest suppliers' },
      { key: 'fell', label: 'Score fell', test: (r) => moved(r) === 'dropped', title: 'Scored lower than at the previous scan' },
      { key: 'unscanned', label: 'Not scanned yet', test: (r) => isUnscanned(r), title: 'Has a domain but no score' },
      { key: 'waived', label: 'Has waivers', test: (r) => r.waived > 0 },
    ],
    sorts: [
      { key: 'score', label: 'Score (weakest first)', firstDir: 'asc', value: (r) => r.score },
      { key: 'vendor', label: 'Supplier', firstDir: 'asc', value: (r) => r.vendor.name },
      { key: 'grade', label: 'Grade (best first)', firstDir: 'asc', value: (r) => (gradeOf(r) === NONE ? null : GRADE_ORDER.indexOf(gradeOf(r) as (typeof GRADE_ORDER)[number])) },
      { key: 'change', label: 'Change', firstDir: 'asc', value: (r) => r.change },
      { key: 'scanned', label: 'Last scanned', firstDir: 'desc', value: (r) => r.scanned_at },
      { key: 'serious', label: 'High or critical', firstDir: 'desc', value: (r) => (r.score === null ? null : r.serious) },
      { key: 'waived', label: 'Waived', firstDir: 'desc', value: (r) => r.waived },
    ],
    defaultSort: { key: 'score', dir: 'asc' },
    pageSize: 25,
  };
}

export const RATINGS_SCHEMA = buildSchema(ratingsDef());

/** The facts the head says: the server's own numbers, in words ("Average 78 · 4 graded D or F"). */
export function headLine(a: Pick<RatingsAnswer, 'average' | 'grades' | 'unscanned' | 'no_domain' | 'expiring_waivers'>, total: number): string {
  const poor = (a.grades.D || 0) + (a.grades.F || 0);
  const bits = [`${total.toLocaleString('en-GB')} ${total === 1 ? 'supplier' : 'suppliers'}`];
  if (a.average !== null && a.average !== undefined) bits.push(`average score ${a.average}`);
  if (poor) bits.push(`${poor} graded D or F`);
  if (a.unscanned) bits.push(`${a.unscanned} not scanned yet`);
  if (a.no_domain) bits.push(`${a.no_domain} with no domain`);
  if (a.expiring_waivers.length) bits.push(`${a.expiring_waivers.length} ${a.expiring_waivers.length === 1 ? 'waiver ends' : 'waivers end'} within 30 days`);
  return bits.join(' · ');
}

/** The one sentence under the head's (i): how suppliers are scanned and graded, from what the server says it uses. */
export function scaleWords(a: Pick<RatingsAnswer, 'every_days' | 'grade_bands'>): string {
  const scan = a.every_days ? `Scanned by tier: critical ${everyWords(a.every_days.critical)}, high ${everyWords(a.every_days.high)}, medium ${everyWords(a.every_days.medium)}, low ${everyWords(a.every_days.low)}. ` : '';
  const b = a.grade_bands;
  const grades = b ? `Outside-in grades run from A to F and a higher score is better: A from ${b.A}, B from ${b.B}, C from ${b.C}, D from ${b.D}, F below. ` : 'Outside-in grades run from A to F and a higher score is better. ';
  return `How each supplier's websites and domains look from outside: certificates, web hardening, email spoofing protection and, with a Shodan key, exposed services and known vulnerabilities. ${scan}${grades}This is not the grade of an assessment.`;
}
