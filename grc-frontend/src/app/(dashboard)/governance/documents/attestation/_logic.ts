// What the Attestation page decides, as plain functions (no React, no @/ imports) so `node --test` runs _logic.test.ts against them:
// which name a campaign's row shows, how its coverage reads, which campaigns a search keeps, how many there are, how times are said.
// Since the page moved onto the design-system kit (UX revamp, Phase 1, group D) this file also holds what the server lists against what was loaded (the
// list is cut at 200 and has no total), the order of the loaded rows, a page of acknowledgements, and how the page says a day and a moment.
import { parseUtc } from '../../../../../lib/serverTime.ts';
import { NOT_SET, formatCount, formatDate as formatDay, formatDateTime as formatMoment } from '../../../../../lib/format.ts';
import { pageRange, type PageRange } from '../../../../../lib/pagerModel.ts';
import { sortRows, type SortState } from '../../../../../components/ui/ds/tableModel.ts';

// ─── Names ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A campaign's own name: "" when it only repeats its document ("Attestation — <title>", "<title> - acknowledgement",
 * "Acknowledgment of <title>"), so a row says the title once and shows the name only when it adds something.
 */
export function ownName(c: { name: string; document_title?: string }): string {
  const name = (c.name || '').trim();
  const title = (c.document_title || '').trim().toLowerCase();
  const rest = (title ? name.toLowerCase().split(title).join(' ') : name.toLowerCase())
    .replace(/attestation|acknowledg(?:ement|ment|e)|\b(?:of|for)\b/g, '')
    .replace(/[\s\-–—:·|,.;()[\]'"“”_/\\]+/g, '');
  return rest ? name : '';
}

// ─── Coverage ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The same ladder as the library's attestation ring (documents/_workspace/atoms.tsx): 90 and over is good, 70 and over is amber. */
export const coverageColour = (pct: number): string => (pct >= 90 ? '#059669' : pct >= 70 ? '#d97706' : '#e11d48');

/** What the server says of a campaign's coverage. */
export interface CoverageSource {
  attestation_percent: number | null;
  acknowledgment_count: number;
  /** the people on the campaign's email domain who could acknowledge: what the percent is of */
  active_domain_users?: number;
  allowed_email_domain?: string | null;
}

export interface CoverageView {
  pct: number;
  /** the filled part of the bar, 0 to 100 */
  width: number;
  colour: string;
  /** "83% · 10/12" (just "83%" when the people it is out of are not known) */
  text: string;
  /** the same in words, for a screen reader and the tooltip: "83% acknowledged: 10 of 12 active users on @example.com" */
  words: string;
}

/** How a campaign's coverage is drawn; null when it is not measured (no active user on its email domain, so no percent). */
export function coverageOf(c: CoverageSource): CoverageView | null {
  const pct = c.attestation_percent;
  if (pct == null) return null;
  const done = c.acknowledgment_count ?? 0;
  const total = c.active_domain_users;
  return {
    pct,
    width: Math.max(0, Math.min(100, pct)),
    colour: coverageColour(pct),
    text: `${pct}%${total != null ? ` · ${done}/${total}` : ''}`,
    words: `${pct}% acknowledged${total != null ? `: ${done} of ${total} active users` : ''}${c.allowed_email_domain ? ` on @${c.allowed_email_domain}` : ''}`,
  };
}

// ─── Search and counts ───────────────────────────────────────────────────────────────────────────────────────────────────

/** The campaigns whose name or document's title has the words in it, in any case; a blank search keeps all of them (the very same array). */
export function filterCampaigns<T extends { name: string; document_title?: string }>(items: T[], search: string): T[] {
  const q = search.trim().toLowerCase();
  if (!q) return items;
  return items.filter((c) => `${c.name} ${c.document_title || ''}`.toLowerCase().includes(q));
}

export const plural = (n: number): string => `${n} ${n === 1 ? 'campaign' : 'campaigns'}`;

/**
 * "9 campaigns", "1 campaign", and "3 of 9 campaigns" while a search narrows them. With `cut` (the server held back older ones): "200+ campaigns", and a
 * search says it is searching the loaded ones, "3 of 200 loaded": the number of campaigns there are in all is not known (see SERVER_LIMIT).
 */
export const countLabel = (shown: number, total: number, searching: boolean, cut = false): string => {
  if (cut) return searching ? `${formatCount(shown)} of ${formatCount(total)} loaded` : `${formatCount(total)}+ campaigns`;
  return searching ? `${shown} of ${plural(total)}` : plural(total);
};

// ─── What the server lists: the list is cut ──────────────────────────────────────────────────────────────────────────────

/**
 * The most campaigns the server lists, newest first: `.limit(200)` in document_attestations.list_campaigns (read only). Its answer carries a `count`, but
 * that is only how many it sent (`len(rows)` after the limit), so there is NO total to show: the page can say the list is cut, never by how much.
 */
export const SERVER_LIMIT = 200;

/** A full page of rows may have more behind it. */
export const isCut = (loaded: number, limit: number = SERVER_LIMIT): boolean => loaded >= limit;

/** The notice above a cut list; null when everything was loaded. The search and the sort work on the loaded rows only. */
export function cutNotice(loaded: number): { title: string; detail: string } | null {
  if (!isCut(loaded)) return null;
  const n = formatCount(loaded);
  return { title: `Showing the newest ${n} campaigns`, detail: `Older ones are not listed. Search and sort use these ${n} only.` };
}

// ─── Order ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** What a campaign has to offer the sort. */
export interface CampaignSortFields { document_title?: string; document_id?: number; status: string; attestation_percent: number | null; due_date?: string | null }

/**
 * The loaded rows in the order a header asks (a new array; the kit's SortState in; no sort leaves them as they came, newest first). The document
 * sorts by its title, the status by its word, the coverage by its percent and the due date by the day; a campaign with no coverage (nobody on its
 * domain) or no due date is last whichever way it sorts, never first.
 */
export function sortCampaigns<T extends CampaignSortFields>(rows: T[], sort: SortState): T[] {
  return sortRows(rows, sort, (c, key) => (key === 'document' ? c.document_title || `Document #${c.document_id ?? ''}`
    : key === 'status' ? c.status : key === 'coverage' ? c.attestation_percent : key === 'due' ? c.due_date ?? null : null));
}

// ─── A page of acknowledgements ──────────────────────────────────────────────────────────────────────────────────────────

/** One page of a long list held on the client (the acknowledgements of a campaign arrive all at once): its rows and where they stand in the whole. */
export function pageOf<T>(rows: readonly T[], page: number, size: number): { rows: T[]; range: PageRange } {
  const range = pageRange(page, size, rows.length);
  return { rows: rows.slice(Math.max(0, range.from - 1), range.to), range };
}

// ─── Times ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

const DATE = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const WHEN = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// the server's times carry no zone and are UTC (parseUtc)

/** "08 Nov 2026"; "—" for none. A due date is a day, said in UTC as it was set. */
export const fmtDate = (v?: string | null): string => { const d = parseUtc(v); return d ? DATE.format(d) : '—'; };

/** The date and the time in the viewer's own locale and zone ("08 Nov 2026, 14:05" in en-GB); "—" for none. */
export const fmtWhen = (v?: string | null): string => { const d = parseUtc(v); return d ? WHEN.format(d) : '—'; };

/** A due date: a DAY (the form sends midnight), said as written whatever zone the viewer is in, "12 Nov 2026"; "Not set" when the campaign has none. */
export const dayText = (value: string | null | undefined): string => formatDay(value, { calendar: true, empty: NOT_SET });

/** The moment somebody signed: the viewer's own day and clock, "12 Nov 2026, 14:05"; "—" when it was not recorded. */
export const momentText = (value: string | null | undefined): string => formatMoment(value);
