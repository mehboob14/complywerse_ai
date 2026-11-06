// The Overview's posture, without React, so `node --test` checks it (postureModel.test.ts): the head of the posture card (the score, the server's grade
// word, how the score moved since last month), the ten section rows with what opens when one is pressed, and the rows of "By framework / By department"
// from GET /governance/dashboard/posture with the library address each row opens. Nothing here scores anything: every score, weight, target and formula
// is the server's (documents-overview), every group figure is the aggregate's (posture.py); this file chooses words, bands and addresses.
import { EMPTY, formatCount } from '../../../../lib/format.ts';
import type { Tone } from '../../../../lib/status.ts';
import { breakdownSections, type Scorecard } from './overviewModel.ts';

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const LIBRARY = '/governance/documents';

// ── the head ─────────────────────────────────────────────────────────────────
const GRADE_TONE: Record<string, Tone> = { excellent: 'success', good: 'success', fair: 'warning', poor: 'danger' };

export interface TrendPoint { label: string; value: number }
export interface Delta { value: number; since: string; /** "Down 3.2 points since Oct" */ words: string }

export interface PostureHead {
  /** null: nothing to score yet (never 0) */
  score: number | null;
  /** the server's own word ("Fair") with the tone that goes with it; the ring takes the same tone, so the word and the colour cannot disagree */
  grade: { label: string; tone: Tone } | null;
  target: number;
  scored: number;
  sections: number;
  /** the overall score at the end of each month; a trend needs two points */
  trend: TrendPoint[];
  delta: Delta | null;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function deltaWords(change: number, since: string): string {
  const value = round1(change);
  if (value === 0) return `Unchanged since ${since}`;
  return `${value < 0 ? 'Down' : 'Up'} ${Math.abs(value).toFixed(1)} points since ${since}`;
}

export function postureHead(card: Scorecard | undefined): PostureHead {
  const perf = card?.performance;
  const sections = breakdownSections(card);
  const score = isNum(perf?.score) ? perf.score : null;
  const trend = (perf?.health_trend ?? []).filter((p) => isNum(p.value)).map((p) => ({ label: p.label, value: p.value }));
  const prev = trend.length > 1 ? trend[trend.length - 2] : null;
  const change = score !== null && prev ? round1(score - prev.value) : null;
  const grade = perf?.grade ? { label: perf.grade[0].toUpperCase() + perf.grade.slice(1), tone: GRADE_TONE[perf.grade] ?? 'neutral' } : null;
  return {
    score, grade,
    target: perf?.components?.[0]?.target ?? 85,
    scored: sections.filter((s) => isNum(s.score)).length,
    sections: sections.length,
    trend: trend.length > 1 ? trend : [],
    delta: change !== null && prev ? { value: change, since: prev.label, words: deltaWords(change, prev.label) } : null,
  };
}

/** The sparkline in words, for a screen reader: "Performance score by month: Oct 58.4, Nov 55.2." */
export const trendAlt = (trend: readonly TrendPoint[]): string => `Performance score by month: ${trend.map((p) => `${p.label} ${p.value}`).join(', ')}.`;

/** "Target 85 · 9 of 10 sections scored" (all scored: "10 sections scored"); "Nothing to score yet" when no section has data. */
export function scoredWords(h: Pick<PostureHead, 'score' | 'target' | 'scored' | 'sections'>): string {
  if (h.score === null || h.sections === 0) return 'Nothing to score yet';
  return `Target ${h.target}${h.scored < h.sections ? ` · ${h.scored} of ${h.sections} sections scored` : ` · ${h.sections} sections scored`}`;
}

// ── the section rows ─────────────────────────────────────────────────────────
export interface Band { tone: Tone; label: string }

/** The cut-offs of score-kit's `scoreBand` (80 and 60), as the tone table reads them. */
export function bandOf(score: number | null | undefined): Band {
  if (!isNum(score)) return { tone: 'neutral', label: 'No data' };
  return score >= 80 ? { tone: 'success', label: 'Strong' } : score >= 60 ? { tone: 'warning', label: 'Fair' } : { tone: 'danger', label: 'Weak' };
}

/** The page that lists what each section counts (the sidebar's own leaves; /governance/approvals forwards to Needs my action). */
export const SECTION_PAGES: Record<string, string> = {
  documents: LIBRARY, mappings: '/governance/mappings', approvals: '/governance/approvals', reviews: '/governance/reviews', exceptions: '/governance/exceptions',
  attestations: `${LIBRARY}/attestation`, committees: '/governance/committees', kris: '/erm/kris', kpi: '/governance/kpi-report', projects: '/is-projects',
};

/** The section's own counts, in the order and the words a person reads them in; a count the server did not send is left out (never 0). */
const FACTS: Record<string, Array<[string, string]>> = {
  documents: [['published', 'Published'], ['draft', 'Draft'], ['in_review', 'In review'], ['approved', 'Approved'], ['expired', 'Expired'], ['archived', 'Archived']],
  mappings: [['documents_mapped', 'Documents mapped'], ['published_unmapped', 'Published, not mapped'], ['statements', 'Statements'], ['statements_mapped', 'Statements mapped']],
  approvals: [['pending_steps', 'Pending requests'], ['overdue_steps', 'Overdue requests'], ['documents_awaiting', 'Documents awaiting'], ['approved_90d', 'Approved in 90 days'], ['signatures', 'Signatures']],
  reviews: [['scheduled_documents', 'Scheduled'], ['overdue', 'Overdue'], ['due_30d', 'Due in 30 days'], ['due_60d', 'Due in 60 days'], ['due_90d', 'Due in 90 days'], ['completed_365d', 'Completed in 12 months']],
  exceptions: [['total', 'Total'], ['pending_approval', 'Pending approval'], ['active', 'Active'], ['expiring_30d', 'Expiring in 30 days'], ['expired', 'Expired']],
  attestations: [['requests_12m', 'Requests in 12 months'], ['open', 'Open'], ['completed', 'Acknowledged'], ['overdue', 'Overdue'], ['active_campaigns', 'Active campaigns']],
  committees: [['active_committees', 'Active committees'], ['upcoming_meetings', 'Upcoming meetings'], ['open_actions', 'Open actions'], ['overdue_actions', 'Overdue actions'], ['actions_completed', 'Completed actions']],
  kris: [['active', 'Active KRIs'], ['red', 'Breached'], ['fresh', 'Measured on schedule'], ['thresholded', 'With thresholds']],
  kpi: [['kpis', 'KPIs'], ['reported', 'Reported'], ['on_target', 'On target']],
  projects: [['total', 'Projects'], ['active', 'Active'], ['on_schedule', 'On schedule'], ['healthy', 'On track'], ['over_budget', 'Over budget']],
};

export interface Fact { label: string; value: string }
export interface MetricView {
  key: string;
  label: string;
  weightPct: number;
  /** null: the metric has no records yet, so the section is scored without it */
  score: number | null;
  scoreText: string;
  /** "24 of 66" where the metric counts records */
  detail: string | null;
  /** the server's own formula */
  formula: string;
  band: Band;
}

export interface SectionRow {
  key: string;
  label: string;
  score: number | null;
  scoreText: string;
  band: Band;
  weightPct: number;
  page: string;
  metrics: MetricView[];
  facts: Fact[];
}

const scoreWord = (score: number | null): string => (isNum(score) ? `${Math.round(score)}` : EMPTY);

export function factsOf(key: string, counts: Record<string, unknown> | undefined): Fact[] {
  const c: Record<string, unknown> = { ...(counts ?? {}) };
  if (key === 'documents') {                               // the library's own words: "In review" is the two states that wait for a person
    const by = (c.by_status ?? {}) as Record<string, unknown>;
    Object.keys(by).forEach((k) => { if (!(k in c)) c[k] = by[k]; });
    if (isNum(by.pending_review) || isNum(by.pending_approval)) c.in_review = (isNum(by.pending_review) ? by.pending_review : 0) + (isNum(by.pending_approval) ? by.pending_approval : 0);
  }
  return (FACTS[key] ?? []).filter(([k]) => isNum(c[k])).map(([k, label]) => ({ label, value: formatCount(c[k] as number) }));
}

/** One row for each section the scorecard carries, in the order the page has always listed them. */
export function sectionRows(card: Scorecard | undefined): SectionRow[] {
  return breakdownSections(card).map((s) => ({
    key: s.key,
    label: s.label,
    score: isNum(s.score) ? s.score : null,
    scoreText: scoreWord(isNum(s.score) ? s.score : null),
    band: bandOf(s.score),
    weightPct: Math.round(s.weight * 100),
    page: SECTION_PAGES[s.key] ?? LIBRARY,
    metrics: (s.metrics ?? []).map((m) => ({
      key: m.key, label: m.label, weightPct: Math.round(m.weight * 100),
      score: isNum(m.score) ? m.score : null, scoreText: isNum(m.score) ? `${Math.round(m.score)}%` : 'No data',
      detail: isNum(m.denominator) && m.denominator > 0 ? `${formatCount(m.numerator)} of ${formatCount(m.denominator)}` : null,
      formula: m.formula, band: bandOf(m.score),
    })),
    facts: factsOf(s.key, s.counts),
  }));
}

/** The row's name for a screen reader: "Reviews: 87, Strong. Opens how it is scored." */
export const sectionName = (r: Pick<SectionRow, 'label' | 'score' | 'scoreText' | 'band'>): string => `${r.label}: ${r.score === null ? 'no data' : `${r.scoreText}, ${r.band.label}`}`;

// ── by framework / by department ─────────────────────────────────────────────
export type GroupBy = 'framework' | 'department';

export interface PostureApiRow {
  /** null: "Not mapped to a framework" / "No department" */
  id: number | null;
  name: string;
  documents: number;
  current: number;
  due: number;
  overdue: number;
  no_review_date: number;
  /** null when no document of the group has a review date (nothing can be late) */
  on_time_pct: number | null;
  due_30d: number;
  needs_attention: number;
  attention: { overdue_reviews: number; awaiting_approval: number; expiring_30d: number; exceptions: number };
  open_exceptions: number;
}

export interface PostureResponse {
  by: GroupBy;
  as_of: string;
  rows: PostureApiRow[];
  /** groups over every page */
  total: number;
  documents_total: number;
  open_exceptions_total: number;
  limit: number;
  offset: number;
  notes: { counting: string; review_health: string; needs_attention: string; open_exceptions: string };
}

/** Ten at a time to begin with; "Show all" asks for the rest in pages of the most the server gives. */
export const FIRST_PAGE = 10;
export const NEXT_PAGE = 100;

/** The library list of a group (and, with `review`, of its overdue reviews): the library's own address, `fw=` / `dept=` with `none` for the row with no group. */
export function groupHref(by: GroupBy, id: number | null, review?: 'overdue'): string {
  const q = new URLSearchParams();
  q.set(by === 'framework' ? 'fw' : 'dept', id === null ? 'none' : String(id));
  if (review) q.set('review', review);
  return `${LIBRARY}?${q.toString()}`;
}

export interface GroupRow {
  key: string;
  name: string;
  documents: string;
  /** "71%"; the dash when no document of the group has a review date. Never 100% while a review is overdue. */
  onTime: string;
  overdue: number;
  overdueText: string;
  needsAttention: string;
  openExceptions: string;
  /** the figures a phone does not have columns for, as one line: "Documents 8 · Attention 10 · Exceptions 17" */
  line: string;
  href: string;
  overdueHref: string;
}

export function onTimeText(pct: number | null): string {
  if (!isNum(pct)) return EMPTY;
  return pct >= 100 ? '100%' : `${Math.floor(pct)}%`;
}

export function groupRow(row: PostureApiRow, by: GroupBy): GroupRow {
  return {
    key: row.id === null ? 'none' : String(row.id),
    name: row.name,
    documents: formatCount(row.documents),
    onTime: onTimeText(row.on_time_pct),
    overdue: row.overdue,
    overdueText: formatCount(row.overdue),
    needsAttention: formatCount(row.needs_attention),
    openExceptions: formatCount(row.open_exceptions),
    line: `Documents ${formatCount(row.documents)} · Attention ${formatCount(row.needs_attention)} · Exceptions ${formatCount(row.open_exceptions)}`,
    href: groupHref(by, row.id),
    overdueHref: groupHref(by, row.id, 'overdue'),
  };
}

export const groupNoun = (by: GroupBy, n: number): string => (by === 'framework' ? (n === 1 ? 'framework' : 'frameworks') : n === 1 ? 'department' : 'departments');

/** "36 frameworks · 66 documents": the true totals the aggregate sends. */
export const groupsMeta = (r: Pick<PostureResponse, 'by' | 'total' | 'documents_total'>): string =>
  `${formatCount(r.total)} ${groupNoun(r.by, r.total)} · ${formatCount(r.documents_total)} ${r.documents_total === 1 ? 'document' : 'documents'}`;

/** What the button under the rows says: "Show all 36" first, "Show 40 more" if a long list is still cut after that (the server gives at most 100 a page). */
export function showMoreLabel(loaded: number, total: number): string {
  const left = Math.max(0, total - loaded);
  return loaded <= FIRST_PAGE ? `Show all ${formatCount(total)}` : `Show ${formatCount(left)} more`;
}

/** Where the next page of groups starts, or null when everything is loaded. */
export const nextOffset = (loaded: number, total: number): number | null => (loaded < total ? loaded : null);
