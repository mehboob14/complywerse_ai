// What the Auditor Portal Overview v2 decides on top of lib/auditorPortal (portalModel.ts, frontModel.ts), apart from React so `node --test` pins it (frontRules.test.ts): the journeys as small
// multiples (one tile per journey: ring = the share of its files decided, green when nothing waits, amber when something does, grey when it has no files), the slim "Waiting for a decision" card
// (the three oldest rows, how long each has waited, where "See all" opens) and the five regulators a card shows. Nothing is invented: every number is the server's.
import type { AreaTileItem } from '../../../../components/overview/charts/areaModel.ts';
import { regulatorRows, waitTone, type BarRowOf, type ObservationSummary } from '../../../../lib/auditorPortal/frontModel.ts';
import { decidedShare, journeyHref, orderJourneys, rowHref, waitingOf, type JourneyCard, type WorkRowPayload } from '../../../../lib/auditorPortal/portalModel.ts';
import { formatCount } from '../../../../lib/format.ts';
import { journeyStatus } from '../../../../lib/statuses/frameworkJourney.ts';

const DAY = 86_400_000;
export const STATUTORY = '/auditor-portal/statutory-audit';
/** The journey tiles' anchor: where a count with several journeys behind it opens. */
export const JOURNEYS_ANCHOR = '#journeys';
/** Where "See all N journeys" goes (the framework workspace lists every journey). */
export const FRAMEWORKS = '/frameworks';
/** Three one-line rows on the page. */
export const WAITING_ROWS = 3;

// ── the journeys as small multiples ───────────────────────────────────────────────────────────────────────────────────

/** The words of the tile colours for this measure: a colour never stands alone. */
export const JOURNEY_WORDS = { good: 'Nothing waiting', warn: 'Waiting for a decision', bad: 'Waiting for a decision', neutral: 'No files yet' } as const;

const plural = (n: number, one: string, other: string): string => `${formatCount(n)} ${n === 1 ? one : other}`;

/** One tile per journey, the ones with the most waiting first. A journey with no file has no share (nothing to decide is not 0%): a grey tile. */
export function journeyTiles(cards: readonly JourneyCard[]): AreaTileItem[] {
  return orderJourneys(cards).map((c): AreaTileItem => {
    const share = decidedShare(c);
    const waiting = waitingOf(c);
    const note = [
      c.status ? journeyStatus.label(c.status) : '',
      c.files.pending > 0 ? plural(c.files.pending, 'file to review', 'files to review') : '',
      c.scope.pending > 0 ? plural(c.scope.pending, 'scope request', 'scope requests') : '',
      share !== null ? `${formatCount(c.files.approved + c.files.rejected)} of ${formatCount(c.files.total)} files decided` : '',
    ].filter(Boolean).join(' · ');
    return { key: String(c.id), label: c.name, value: share, display: share === null ? undefined : `${share}%`, tone: share === null ? 'neutral' : waiting > 0 ? 'warn' : 'good', href: journeyHref(c.id), note };
  });
}

// ── what waits ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** How long an item has waited, in whole days (never negative); null when it has no date. */
export function waitedDays(since: string | null | undefined, now: Date): number | null {
  const t = since ? Date.parse(since) : NaN;
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((now.getTime() - t) / DAY));
}

export interface WaitingRow { key: string; kind: 'file' | 'scope'; title: string; href: string; action: 'Review' | 'Decide'; wait: { text: string; tone: 'neutral' | 'warning' | 'danger' } | null; name: string }

/** The oldest rows (the server lists the oldest first) as one-line rows: the wait reads "Waiting 191d" (amber from 30 days, red from 90: the age buckets' cuts). */
export function waitingRows(rows: readonly WorkRowPayload[], now: Date, limit = WAITING_ROWS): WaitingRow[] {
  return rows.slice(0, Math.max(1, limit)).map((r): WaitingRow => {
    const days = waitedDays(r.since, now);
    const tone = days === null ? null : waitTone(days);
    const title = r.title || (r.kind === 'file' ? 'A file' : 'A scope request');
    const action = r.kind === 'file' ? 'Review' : 'Decide';
    const wait = days === null ? null : { text: `Waiting ${days}d`, tone: tone === 'danger' ? 'danger' as const : tone === 'warning' ? 'warning' as const : 'neutral' as const };
    return { key: `${r.kind}-${r.id}`, kind: r.kind, title, href: rowHref(r), action, wait, name: `${action}: ${title}${r.journey ? `, ${r.journey}` : ''}${wait ? `, ${wait.text.toLowerCase()}` : ''}` };
  });
}

/** Where "See all N" opens: the queue of the one journey that has anything waiting, else the journey tiles (the queue is per journey: there is no list across them). */
export function waitingTarget(cards: readonly JourneyCard[]): string {
  const holders = cards.filter((c) => waitingOf(c) > 0);
  if (holders.length !== 1) return JOURNEYS_ANCHOR;
  const only = holders[0];
  return journeyHref(only.id, { kind: only.files.pending > 0 ? 'files' : 'scope' });
}

/** A share of a whole as a whole percent for a tile's bar; null when there is no whole. */
export const share = (part: number, whole: number): number | null => (whole > 0 ? Math.max(0, Math.min(100, Math.round((part / whole) * 100))) : null);

// ── regulators ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The five regulators with the most open observations, each opening the register on it; `more` is how many others there are (the card says "See all"). */
export function topRegulators(s: ObservationSummary | null | undefined, keep = 5): { rows: BarRowOf[]; more: number } | null {
  const all = regulatorRows(s, keep);
  if (!all || !s) return null;
  const rows = all.filter((r) => !!r.href).slice(0, keep).map(({ note: _note, ...r }) => r);                     // a bar is its name and its number: "24 in all" goes
  return { rows, more: Math.max(0, s.regulators.filter((r) => r.open > 0).length - rows.length) };
}
