// The Governance Overview's rules, without React, so `node --test` checks them (overviewModel.test.ts): the eight "needs attention" counters
// (what each is, where it opens, which request answers it and what it shows while that request loads, fails or has nothing), what each tile
// reads, and the words that stand in for a chart. The page only draws what this decides. Nothing here computes a score: every score, weight,
// target and formula comes from the server (/governance/dashboard/documents-overview); the page's own arithmetic stays what it was
// (the sum and the live rate of the throughput card).
import { formatDate } from '../../../../lib/format.ts';
import type { Tone } from '../../../../lib/status.ts';
import { canRetry, statusOf } from '../../../../components/ui/ds/reportOutcome.ts';

// ── where a request stands ───────────────────────────────────────────────────
export type Load = 'loading' | 'error' | 'ready';

/** Where a request stands, from what React Query reports. An earlier answer still stands when a refresh fails. `null` is no answer: the main dashboard
 *  asks for the scorecard under the same key and stores null there when its own request failed (it catches), and this page must not read that as "no data". */
export function loadOf(q: { status: 'pending' | 'error' | 'success'; data?: unknown }): Load {
  if (q.data === null) return 'error';
  if (q.status === 'success' || q.data !== undefined) return 'ready';
  return q.status === 'error' ? 'error' : 'loading';
}

/** React Query's retry for the Overview's seven requests: a refusal (invalid, not allowed, not found) is final and is said at once, the rest is tried once more. */
export const retryOverview = (failures: number, error: unknown): boolean => canRetry(error) && failures < 1;

/** The server refused the request (403): the person may not read this, which is not a failure to load and never a 0. */
export const isRefused = (error: unknown): boolean => statusOf(error) === 403;

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const count = (n: unknown): number => (isNum(n) ? n : 0);

// ── the eight counters ───────────────────────────────────────────────────────
export type AttentionKey = 'documents_awaiting_approval' | 'overdue_reviews' | 'expiring_documents_30d' | 'exceptions_attention' | 'open_gaps' | 'overdue_attestations' | 'overdue_actions' | 'red_kris';

/** The requests that can answer a counter when the scorecard does not (the answer the page always fell back to). */
export type FallbackName = 'pending' | 'overdue' | 'expiring' | 'exceptions';
export type SourceName = 'scorecard' | FallbackName;

export interface Attention {
  /** the key of `attention_queue` in /governance/dashboard/documents-overview */
  key: AttentionKey;
  label: string;
  /** where it opens */
  href: string;
  /** the colour of its dot while the counter is above 0: a reading aid, the label and the number carry the meaning */
  tone: Tone;
  fallback?: FallbackName;
  /** true: the destination lists exactly these records */
  exact: boolean;
  /** what the destination cannot do yet; present on every counter that is not exact */
  gap?: string;
}

const LIBRARY = '/governance/documents';

/** The counters in the order the page has always listed them. */
export const ATTENTION: readonly Attention[] = [
  { key: 'documents_awaiting_approval', label: 'Documents awaiting approval', href: `${LIBRARY}?status=pending_review,pending_approval`, tone: 'pending', fallback: 'pending', exact: true },
  // the library's review lens uses the scorecard's own definition (approved and in-force documents past their review date); the Reviews tab
  // of the Documents bar lists every document that is not archived or expired, so its count differs
  { key: 'overdue_reviews', label: 'Overdue reviews', href: `${LIBRARY}?review=overdue`, tone: 'danger', fallback: 'overdue', exact: true },
  // the library's expiry filter is the server rule restated for the browser (approved or in force, expiry from now to now + 30 days; proven on 810 combinations in
  // libraryModel's tests): exact while the library is not cut (it filters the documents it has loaded, and says so when it is cut)
  { key: 'expiring_documents_30d', label: 'Documents expiring in 30 days', href: `${LIBRARY}?expiry=30d`, tone: 'warning', fallback: 'expiring', exact: true },
  {
    key: 'exceptions_attention', label: 'Exceptions pending or expiring', href: '/governance/exceptions', tone: 'warning', fallback: 'exceptions', exact: false,
    gap: 'The Exceptions page keeps its status filter in the page, not in the address, so it opens unfiltered.',
  },
  {
    key: 'open_gaps', label: 'Open gap findings', href: LIBRARY, tone: 'warning', exact: false,
    gap: 'Gap findings are listed per document (its Gap analysis view); no page lists them across documents.',
  },
  {
    key: 'overdue_attestations', label: 'Overdue attestations', href: `${LIBRARY}/attestation`, tone: 'danger', exact: false,
    gap: 'The count is acknowledgement requests nobody has answered in time; the Attestation page lists campaigns, not the people who owe one.',
  },
  {
    key: 'overdue_actions', label: 'Overdue committee actions', href: '/governance/committees/actions?overdue=1', tone: 'danger', exact: false,
    gap: 'The Overdue filter leaves out an action someone saved by hand with the status Overdue; the count includes it.',
  },
  {
    key: 'red_kris', label: 'Breached KRIs', href: '/erm/kris', tone: 'danger', exact: false,
    gap: 'The KRIs page has no status filter; it lists every indicator, the breached ones in red.',
  },
];

export const ATTENTION_KEYS: readonly AttentionKey[] = ATTENTION.map((a) => a.key);

export interface Source<T> {
  load: Load;
  data?: T;
}

/** What the counters read: the scorecard first, and for four of them the request that always stood behind it. */
export interface AttentionSources {
  scorecard: Source<{ attention_queue?: Partial<Record<AttentionKey | 'total', number>> }>;
  pending: Source<{ count?: number }>;
  overdue: Source<{ count?: number }>;
  expiring: Source<{ by_timeframe?: Record<string, number> }>;
  exceptions: Source<{ pending_approval?: number; expiring_soon?: number }>;
}

export type Counter =
  | { state: 'ready'; value: number }
  | { state: 'loading' }
  /** the request failed: "Unavailable", never 0; `retry` names the requests to ask again */
  | { state: 'error'; retry: SourceName[] }
  /** the answer came and carries nothing for this counter */
  | { state: 'none' };

function fallbackValue(name: FallbackName, s: AttentionSources): number | undefined {
  switch (name) {
    case 'pending': return isNum(s.pending.data?.count) ? s.pending.data?.count : undefined;
    case 'overdue': return isNum(s.overdue.data?.count) ? s.overdue.data?.count : undefined;
    case 'expiring': return isNum(s.expiring.data?.by_timeframe?.['30_days']) ? s.expiring.data?.by_timeframe?.['30_days'] : undefined;
    case 'exceptions': {
      const e = s.exceptions.data;
      return e && (isNum(e.pending_approval) || isNum(e.expiring_soon)) ? count(e.pending_approval) + count(e.expiring_soon) : undefined;
    }
  }
}

/** What one counter shows. The scorecard's number wins; while it loads the counter waits for it (a dedicated answer would show first and then change);
 *  when it failed or does not carry the counter, the dedicated request answers, as the page always did. A failure is never read as 0. */
export function counterFor(def: Attention, s: AttentionSources): Counter {
  if (s.scorecard.load === 'loading') return { state: 'loading' };
  const primary = s.scorecard.load === 'ready' ? s.scorecard.data?.attention_queue?.[def.key] : undefined;
  if (isNum(primary)) return { state: 'ready', value: primary };
  const other = def.fallback ? s[def.fallback] : undefined;
  if (def.fallback && other) {
    if (other.load === 'ready') {
      const value = fallbackValue(def.fallback, s);
      if (isNum(value)) return { state: 'ready', value };
    }
    if (other.load === 'loading') return { state: 'loading' };
  }
  const failed: SourceName[] = [];
  if (s.scorecard.load === 'error') failed.push('scorecard');
  if (def.fallback && s[def.fallback].load === 'error') failed.push(def.fallback);
  return failed.length ? { state: 'error', retry: failed } : { state: 'none' };
}

/** The sources of the shared inbox that hold the Governance module's own work: document requests (reviews, approvals, acknowledgements) and sign-offs.
 *  Assessment evidence belongs to Compliance, the requests the person sent are not theirs to do. */
export const GOVERNANCE_SOURCES: readonly ('doc.lifecycle' | 'doc.signoff')[] = ['doc.lifecycle', 'doc.signoff'];

export type Total = { state: 'ready'; value: number } | { state: 'loading' } | { state: 'error' } | { state: 'none' };

/** The server's own total of the eight (`attention_queue.total`). */
export function attentionTotal(s: AttentionSources): Total {
  if (s.scorecard.load === 'loading') return { state: 'loading' };
  if (s.scorecard.load === 'error') return { state: 'error' };
  const total = s.scorecard.data?.attention_queue?.total;
  return isNum(total) ? { state: 'ready', value: total } : { state: 'none' };
}

/** Every counter failed: the card says it once instead of eight times. */
export const allUnavailable = (counters: readonly Counter[]): boolean => counters.length > 0 && counters.every((c) => c.state === 'error');

// ── the tiles ────────────────────────────────────────────────────────────────
export const SECTION_ORDER = ['documents', 'mappings', 'approvals', 'reviews', 'exceptions', 'attestations', 'committees', 'kris', 'kpi', 'projects'] as const;

export interface ScoreMetric { key: string; label: string; weight: number; score: number | null; numerator: number; denominator: number; formula: string }
export interface ScoreSection { key: string; label: string; weight: number; score: number | null; metrics: ScoreMetric[]; /** the section's own counts, as the server sends them (their keys differ by section) */ counts?: Record<string, unknown> }
export interface Scorecard {
  as_of?: string;
  sections?: Record<string, ScoreSection>;
  attention_queue?: Record<string, number>;
  performance?: {
    score: number | null;
    grade: string | null;
    components?: Array<{ key: string; label: string; score: number | null; weight: number; target: number }>;
    /** the overall score at the end of each month (the server snapshots it when the scorecard is read; it fills in over time) */
    health_trend?: Array<{ label: string; year?: string; value: number }>;
  };
}

/** The sections the scorecard carries, in the order of the breakdown (the caller's own section type comes back: the detail dialog takes more than this file reads). */
export function breakdownSections<S extends ScoreSection>(card: { sections?: Record<string, S> } | undefined): S[] {
  const sections = card?.sections ?? {};
  return SECTION_ORDER.map((key) => sections[key]).filter((s): s is S => Boolean(s));
}

export interface PerformanceTile {
  /** null: nothing to score yet (never 0) */
  score: number | null;
  grade: string | null;
  scored: number;
  sections: number;
}

export function performanceTile(card: Scorecard | undefined): PerformanceTile {
  const sections = breakdownSections(card);
  const score = card?.performance?.score;
  return { score: isNum(score) ? score : null, grade: card?.performance?.grade ?? null, scored: sections.filter((s) => isNum(s.score)).length, sections: sections.length };
}

export interface CoverageTile {
  /** null: no document to map yet */
  percent: number | null;
  mapped: number;
  of: number;
  /** the server's own formula for the number */
  formula: string;
}

/** "Docs mapped" of the Mappings section; undefined when the scorecard does not carry it. */
export function coverageTile(card: Scorecard | undefined): CoverageTile | undefined {
  const metric = card?.sections?.mappings?.metrics?.find((m) => m.key === 'document_coverage');
  if (!metric) return undefined;
  return { percent: isNum(metric.score) ? metric.score : null, mapped: count(metric.numerator), of: count(metric.denominator), formula: metric.formula };
}

export interface DocumentsTile {
  /** the documents that are not archived, as the library's "All documents" counts them */
  active: number;
  archived: number;
  published: number;
  /** waiting for a review or an approval */
  inReview: number;
}

export interface DocumentsSummary { total_documents?: number; by_status?: Record<string, number> }

export function documentsTile(summary: DocumentsSummary | undefined): DocumentsTile {
  const by = summary?.by_status ?? {};
  const archived = count(by.archived);
  return {
    active: Math.max(0, count(summary?.total_documents) - archived),
    archived,
    published: count(by.published),
    inReview: count(by.pending_review) + count(by.pending_approval),
  };
}

export const documentsHref = {
  all: LIBRARY,
  published: `${LIBRARY}?status=published`,
  inReview: `${LIBRARY}?status=pending_review,pending_approval`,
  archived: `${LIBRARY}?status=archived`,
} as const;

// ── the posture radar ────────────────────────────────────────────────────────
export interface PostureRow { key: string; label: string; /** what the radar prints beside a spoke */ short: string; score: number | null; target: number; weightPct: number }

const SHORT: Record<string, string> = { approvals: 'Approvals', kris: 'KRIs', kpi: 'KPI', projects: 'Projects' };

/** One row for each weighted section of the performance score; a section with no data keeps `score: null`. */
export function postureRows(components: NonNullable<NonNullable<Scorecard['performance']>['components']> | undefined): PostureRow[] {
  return (components ?? []).map((c) => ({
    key: c.key,
    label: c.label,
    short: SHORT[c.key] ?? c.label,
    score: isNum(c.score) ? Math.round(c.score) : null,
    target: c.target,
    weightPct: Math.round(c.weight * 100),
  }));
}

/** A radar needs at least this many scored sections to be a shape; with fewer the list beside it is the whole picture. */
export const RADAR_MIN_SPOKES = 3;

/** The sections the radar plots: those with a score (a section with no data is not a score of 0). */
export const radarSpokes = (rows: readonly PostureRow[]): PostureRow[] => rows.filter((r) => r.score != null);

/** The radar in words, for a screen reader: every section and its score. */
export function postureSummary(rows: readonly PostureRow[]): string {
  if (!rows.length) return 'No section scores yet.';
  const target = rows.every((r) => r.target === rows[0].target) ? ` Target ${rows[0].target}%.` : '';
  return `Governance section scores: ${rows.map((r) => `${r.label} ${r.score == null ? 'no data' : `${r.score}%`}`).join(', ')}.${target}`;
}

// ── the throughput chart ─────────────────────────────────────────────────────
export interface TrendRow { month: string; label: string; created: number; published: number }
export interface TrendPoint { month: string; count: number }

/** "2026-05" -> "May 26". Taken from the text, never through a Date: a month read as midnight UTC is the month before, west of Greenwich. */
export function monthLabel(month: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return month;
  const [, name, year] = formatDate(`${month}-01`, { empty: '' }).split(' ');
  return name && year ? `${name} ${year.slice(2)}` : month;
}

/** The last `keep` months: what was created and what was published in each (both series come from the server over the same months). */
export function trendRows(trends: { created?: TrendPoint[]; published?: TrendPoint[] } | undefined, keep = 6): TrendRow[] {
  const published = trends?.published ?? [];
  return (trends?.created ?? []).slice(-keep).map((c) => ({
    month: c.month,
    label: monthLabel(c.month),
    created: count(c.count),
    published: count(published.find((p) => p.month === c.month)?.count),
  }));
}

export interface TrendTotals { created: number; published: number; /** published / created over the window; null when nothing was created */ liveRate: number | null }

export function trendTotals(rows: readonly TrendRow[]): TrendTotals {
  const created = rows.reduce((n, r) => n + r.created, 0);
  const published = rows.reduce((n, r) => n + r.published, 0);
  return { created, published, liveRate: created > 0 ? Math.round((published / created) * 100) : null };
}

/** Nothing to chart: no month, or no document created or published in any of them. */
export const trendIsEmpty = (rows: readonly TrendRow[]): boolean => rows.every((r) => r.created === 0 && r.published === 0);

/** The chart in words, for a screen reader. */
export function trendSummary(rows: readonly TrendRow[]): string {
  if (trendIsEmpty(rows)) return 'No documents were created or published in this period.';
  return `Documents created and published each month: ${rows.map((r) => `${r.label}, ${r.created} created, ${r.published} published`).join('; ')}.`;
}

/** The band words of score-kit's `scoreBand` as the tone table reads them. */
export const BAND_TONE: Record<string, Tone> = { strong: 'success', fair: 'warning', weak: 'danger', 'no data': 'neutral' };

/** "No data" where a score is missing, else "66%". */
export const scoreText = (score: number | null | undefined): string => (isNum(score) ? `${Math.round(score)}%` : 'No data');

