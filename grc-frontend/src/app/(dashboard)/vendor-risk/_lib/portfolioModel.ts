// What the module's header and rail work out: the line of facts, the rail's counts, which routes are a drill-down (they draw their
// own header), which rail entry is on. Pure, so `node --test` runs portfolioModel.test.ts against it.

export interface Counts { vendors: number; critical: number; open_findings: number; intake_pending: number }

const plural = (n: number, one: string): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : `${one}s`}`;

/** "12 vendors · 2 critical · 1 open finding": a part that is zero is dropped (not the vendors); "Third-party risk" until the
 *  numbers are in (or when they could not be read). */
export function headerStats(counts?: Partial<Counts> | null): string {
  if (!counts || typeof counts.vendors !== 'number') return 'Third-party risk';
  const parts = [plural(counts.vendors, 'vendor')];
  if ((counts.critical ?? 0) > 0) parts.push(`${counts.critical!.toLocaleString('en-US')} critical`);
  if ((counts.open_findings ?? 0) > 0) parts.push(plural(counts.open_findings!, 'open finding'));
  return parts.join(' · ');
}

/** What a rail badge says: nothing for zero, "99+" past 99. */
export function badgeText(n?: number | null): string {
  if (typeof n !== 'number' || !(n > 0)) return '';
  return n > 99 ? '99+' : String(Math.floor(n));
}

// The pages that draw their own header (a back link, the record's name, its actions): a vendor's record and the questionnaire
// builder. The module header would only double it.
const VENDOR_RECORD = /^\/vendor-risk\/vendors\/\d+(\/|$)/;
const BUILDER = /^\/vendor-risk\/questionnaires\/[^/]+\/builder(\/|$)/;

export function isDrillDown(pathname: string): boolean {
  const path = (pathname || '').split(/[?#]/)[0];
  return VENDOR_RECORD.test(path) || BUILDER.test(path);
}

/** Moving between list pages keeps the page's cached data (no flash); only a vendor's own pages remount, one per record. */
export const shellKey = (pathname: string): string => (/\/vendor-risk\/vendors\/\d+/.test(pathname || '') ? pathname : 'vendor-risk-shell');

/** Whether a rail entry is the one on: its own page (and, unless `exact`, the pages beneath it). */
export function isActive(pathname: string, href: string, exact = false): boolean {
  const path = (pathname || '').split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  return exact ? path === href : path === href || path.startsWith(`${href}/`);
}
