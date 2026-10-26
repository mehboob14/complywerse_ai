// What the Attestation page decides, as plain functions (no React, no @/ imports) so `node --test` runs _logic.test.ts against them:
// which name a campaign's row shows, how its coverage reads, which campaigns a search keeps, how many there are, how times are said.
import { parseUtc } from '../../../../../lib/serverTime.ts';

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

/** "9 campaigns", "1 campaign", and "3 of 9 campaigns" while a search narrows them. */
export const countLabel = (shown: number, total: number, searching: boolean): string => (searching ? `${shown} of ${plural(total)}` : plural(total));

// ─── Times ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

const DATE = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const WHEN = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// the server's times carry no zone and are UTC (parseUtc)

/** "08 Nov 2026"; "—" for none. A due date is a day, said in UTC as it was set. */
export const fmtDate = (v?: string | null): string => { const d = parseUtc(v); return d ? DATE.format(d) : '—'; };

/** The date and the time in the viewer's own locale and zone ("08 Nov 2026, 14:05" in en-GB); "—" for none. */
export const fmtWhen = (v?: string | null): string => { const d = parseUtc(v); return d ? WHEN.format(d) : '—'; };
