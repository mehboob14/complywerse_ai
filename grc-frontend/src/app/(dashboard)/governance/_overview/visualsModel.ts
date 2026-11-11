// What the Governance Overview's graphics draw, without React, so `node --test` checks it (visualsModel.test.ts): the six figures the page opens with
// (each with its state, its change and the line it has over time), and the rows, slices and series of every chart card, built from the answers the page
// already holds (the scorecard, the documents summary, the throughput, the expiring-soon and exceptions answers, the posture groups). Nothing here asks for
// anything, scores anything or invents a number: a figure is the server's, or a sum or a difference of the server's (the (i) of the card says which), and
// a series that cannot be read is `null` (a dash in the table), never 0. The kit's own pure rules are components/overview/charts/chartModel.ts.
import { formatCount, statusLabel } from '../../../../lib/format.ts';
import { TONE, documentStatus, exceptionStatus, type Tone } from '../../../../lib/status.ts';
import { foldTail, type Slice } from '../../../../components/overview/charts/chartModel.ts';
import { RAMP, STATUS } from '../../../../components/overview/charts/palette.ts';
import { REVIEW_BUCKET_LABEL, STAGE_ORDER } from '../documents/_workspace/libraryModel.ts';
import {
  ATTENTION, documentsTile as documentFigures, isRefused, monthLabel, trendIsEmpty, trendTotals,
  type AttentionKey, type Counter, type DocumentsSummary, type Load, type Scorecard, type Total, type TrendPoint, type TrendRow,
} from './overviewModel.ts';
import { bandOf, groupHref, postureHead, sectionRows, trendAlt, type GroupBy, type PostureApiRow } from './postureModel.ts';

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const LIBRARY = '/governance/documents';

/** The tone of a state word as the colour of a bar or a segment (the pills' own dots): a state is never a categorical hue. */
export const toneColor = (tone: Tone): string => TONE[tone].dot;

/** A request's answer as a chart card or a tile reads it: where it stands, what it answered and (for a refusal) why it failed. */
export interface Answer<T> { load: Load; data?: T; error?: unknown }

export type CardState = 'loading' | 'error' | 'denied' | 'empty' | 'ready';

/** The state of a card that rests on several requests: loading while any loads, a refusal if any was refused, else an error if any failed. */
export function cardState(...answers: ReadonlyArray<Answer<unknown>>): 'loading' | 'error' | 'denied' | 'ready' {
  if (answers.some((a) => a.load === 'loading')) return 'loading';
  const failed = answers.filter((a) => a.load === 'error');
  if (failed.some((a) => isRefused(a.error))) return 'denied';
  return failed.length ? 'error' : 'ready';
}

// ── the throughput by calendar month ─────────────────────────────────────────────────────────────────────────────────────

export interface TrendsAnswer { created?: TrendPoint[]; published?: TrendPoint[] }

/** The calendar months (`YYYY-MM`) from `keep - 1` before the one `now` is in, to that one. The server reckons months in UTC, so does this. */
export function monthWindow(now: Date, keep = 6): string[] {
  const out: string[] = [];
  for (let i = keep - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

/** What was created and what was published in each of the last `keep` calendar months. The server leaves out a month in which nothing happened, which is a
 *  true 0 (it counts every document of the window), so a missing month is 0 here and the line runs to the month that is now. */
export function monthSeries(trends: TrendsAnswer | undefined, now: Date, keep = 6): TrendRow[] {
  const count = (list: TrendPoint[] | undefined, month: string): number => {
    const n = list?.find((p) => p.month === month)?.count;
    return isNum(n) ? n : 0;
  };
  return monthWindow(now, keep).map((month) => ({ month, label: monthLabel(month), created: count(trends?.created, month), published: count(trends?.published, month) }));
}

export { trendIsEmpty, trendTotals };

// ── the six figures ──────────────────────────────────────────────────────────────────────────────────────────────────────

export type TileState = 'ready' | 'loading' | 'error' | 'denied' | 'none';
export type TileTone = 'default' | 'success' | 'warning' | 'danger';
export type ChangeTone = 'good' | 'bad' | 'neutral';
export type SourceKey = 'scorecard' | 'summary' | 'trends' | 'pending' | 'overdue' | 'expiring' | 'exceptions';

export interface TileModel {
  key: 'score' | 'attention' | 'documents' | 'reviews' | 'coverage' | 'published';
  label: string;
  state: TileState;
  /** the figure as text; null: nothing is recorded (the tile says so, never 0) */
  value: string | null;
  unit?: string;
  note?: string;
  info?: string;
  /** an address of this page's module (the page adds `?from=`), or a `#anchor` */
  href?: string;
  linkLabel?: string;
  tone: TileTone;
  delta: { text: string; direction: 'up' | 'down' | 'flat'; tone: ChangeTone; since?: string } | null;
  spark: { values: Array<number | null>; label: string; summary: string; floor?: number } | null;
  /** 0 to 100, for a share */
  progress: number | null;
  /** the requests to ask again when the tile failed */
  retry: SourceKey[];
  failTitle: string;
}

export interface HeroInputs {
  scorecard: Answer<Scorecard>;
  summary: Answer<DocumentsSummary>;
  trends: Answer<TrendsAnswer>;
  /** the server's own total of the eight counters, and each counter as the band reads it */
  total: Total;
  counters: Partial<Record<AttentionKey, Counter>>;
  now: Date;
}

const GRADE_TONE: Record<string, TileTone> = { excellent: 'success', good: 'success', fair: 'warning', poor: 'danger' };

function base(key: TileModel['key'], label: string, failTitle: string, retry: SourceKey[]): TileModel {
  return { key, label, state: 'ready', value: null, tone: 'default', delta: null, spark: null, progress: null, retry, failTitle };
}

/** A tile that rests on one request: its state while that request has not answered with something to show. */
function waiting(t: TileModel, a: Answer<unknown>): TileModel | null {
  if (a.load === 'loading') return { ...t, state: 'loading' };
  if (a.load === 'error') return { ...t, state: isRefused(a.error) ? 'denied' : 'error' };
  return null;
}

const rounded1 = (n: number): number => Math.round(n * 10) / 10;

/** How the score moved since the month before, in the words and the tone of a tile ("Down 0.1 points since Oct"): one decimal, which the kit's `deltaOf`
 *  (whole numbers, for counts) would round away. More is better. */
export function scoreDelta(card: Scorecard | undefined): TileModel['delta'] {
  const head = postureHead(card);
  if (!head.delta) return null;
  const change = rounded1(head.delta.value);
  if (change === 0) return { text: 'No change', direction: 'flat', tone: 'neutral', since: `since ${head.delta.since}` };
  return { text: `${change < 0 ? 'Down' : 'Up'} ${Math.abs(change).toFixed(1)} ${Math.abs(change) === 1 ? 'point' : 'points'}`, direction: change < 0 ? 'down' : 'up', tone: change < 0 ? 'bad' : 'good', since: `since ${head.delta.since}` };
}

function scoreTile(i: HeroInputs): TileModel {
  const t = base('score', 'Governance score', "Couldn't load the score", ['scorecard']);
  const w = waiting(t, i.scorecard);
  if (w) return w;
  const head = postureHead(i.scorecard.data);
  if (head.score === null) return { ...t, state: 'none', info: 'Nothing to score yet: it appears once there are documents, reviews or approvals to measure.' };
  const values = head.trend.map((p) => p.value);
  return {
    ...t,
    value: String(Math.round(head.score)),
    unit: '/ 100',
    note: `${head.grade ? `${head.grade.label} · ` : ''}target ${head.target}`,
    info: 'The weighted mean of the ten section scores, as the server computes it. The line is the score at the end of each month so far; it builds up as the months pass.',
    href: '#posture',
    linkLabel: `Governance score ${Math.round(head.score)} out of 100. Go to the section scores`,
    tone: head.grade ? (GRADE_TONE[head.grade.label.toLowerCase()] ?? 'default') : 'default',
    delta: scoreDelta(i.scorecard.data),
    spark: values.length > 1 ? { values, label: 'Governance score by month', summary: trendAlt(head.trend), floor: 0 } : null,
    progress: Math.max(0, Math.min(100, head.score)),
  };
}

function attentionTile(i: HeroInputs): TileModel {
  const t = base('attention', 'Needs attention', "Couldn't load what needs attention", ['scorecard', 'overdue', 'expiring', 'pending', 'exceptions']);
  const total = i.total;
  if (total.state === 'loading') return { ...t, state: 'loading' };
  if (total.state === 'error') return { ...t, state: isRefused(i.scorecard.error) ? 'denied' : 'error' };
  if (total.state === 'none') return { ...t, state: 'none' };
  const areas = ATTENTION.filter((a) => {
    const c = i.counters[a.key];
    return c?.state === 'ready' && c.value > 0;
  }).length;
  return {
    ...t,
    value: formatCount(total.value),
    unit: total.value === 1 ? 'item' : 'items',
    tone: total.value > 0 ? 'warning' : 'success',
    note: total.value > 0 ? `In ${areas} of ${ATTENTION.length} areas` : 'Nothing needs attention',
    info: 'The eight counters below added up, as the server counts them. An item that is in two of them is counted twice.',
    href: '#attention',
    linkLabel: `${formatCount(total.value)} items need attention. Go to the counters`,
  };
}

/** The Publishing metric of the Documents section: published documents out of the documents that are not archived (the server's own share). */
export const publishingScore = (card: Scorecard | undefined): number | null => {
  const s = card?.sections?.documents?.metrics?.find((m) => m.key === 'publishing_rate')?.score;
  return isNum(s) ? s : null;
};

function documentsTile(i: HeroInputs): TileModel {
  const t = base('documents', 'Documents', "Couldn't load the documents", ['summary']);
  const w = waiting(t, i.summary);
  if (w) return w;
  const { active, published, inReview } = documentFigures(i.summary.data);
  const share = i.scorecard.load === 'ready' ? publishingScore(i.scorecard.data) : null;
  return {
    ...t,
    value: formatCount(active),
    unit: active === 1 ? 'document' : 'documents',
    note: `${formatCount(published)} published · ${formatCount(inReview)} in review`,
    info: 'Documents that are not archived. The bar is the Publishing score: published documents out of the documents that are not archived.',
    href: LIBRARY,
    linkLabel: `${formatCount(active)} documents. Open the library`,
    progress: share === null ? null : Math.max(0, Math.min(100, share)),
  };
}

function reviewsTile(i: HeroInputs): TileModel {
  const t = base('reviews', 'Overdue reviews', "Couldn't load the reviews", ['scorecard', 'overdue']);
  const c = i.counters.overdue_reviews;
  if (!c || c.state === 'loading') return { ...t, state: 'loading' };
  if (c.state === 'error') return { ...t, state: isRefused(i.scorecard.error) ? 'denied' : 'error', retry: c.retry as SourceKey[] };
  if (c.state === 'none') return { ...t, state: 'none' };
  const due = i.scorecard.data?.sections?.reviews?.counts?.due_30d;
  return {
    ...t,
    value: formatCount(c.value),
    tone: c.value > 0 ? 'danger' : 'success',
    note: isNum(due) ? `${formatCount(due)} more due in 30 days` : undefined,
    info: 'Approved and published documents whose review date has passed.',
    href: `${LIBRARY}?review=overdue`,
    linkLabel: `${formatCount(c.value)} overdue reviews. Open them in the library`,
  };
}

function coverageTile(i: HeroInputs): TileModel {
  const t = base('coverage', 'Coverage', "Couldn't load the coverage", ['scorecard']);
  const w = waiting(t, i.scorecard);
  if (w) return w;
  const metric = i.scorecard.data?.sections?.mappings?.metrics?.find((m) => m.key === 'document_coverage');
  if (!metric) return { ...t, state: 'none' };
  const of = isNum(metric.denominator) ? metric.denominator : 0;
  const mapped = isNum(metric.numerator) ? metric.numerator : 0;
  if (!isNum(metric.score)) return { ...t, state: 'none', info: metric.formula };
  return {
    ...t,
    value: `${Math.round(metric.score)}%`,
    note: of === 0 ? 'No documents to map yet' : `${formatCount(mapped)} of ${formatCount(of)} documents mapped`,
    info: metric.formula,
    href: '/governance/mappings',
    linkLabel: `Coverage ${Math.round(metric.score)} percent. Open the mappings`,
    progress: Math.max(0, Math.min(100, metric.score)),
  };
}

function publishedTile(i: HeroInputs): TileModel {
  const t = base('published', 'Published, 6 months', "Couldn't load the throughput", ['trends']);
  const w = waiting(t, i.trends);
  if (w) return w;
  const rows = monthSeries(i.trends.data, i.now);
  const totals = trendTotals(rows);
  const values = rows.map((r) => r.published);
  return {
    ...t,
    value: formatCount(totals.published),
    note: `${formatCount(totals.created)} created${totals.liveRate === null ? '' : ` · ${totals.liveRate}% published`}`,
    info: 'Documents published in the last six calendar months, month by month in the line. The share is the documents published in these months out of the documents created in them.',
    href: LIBRARY,
    linkLabel: `${formatCount(totals.published)} documents published in six months. Open the library`,
    spark: trendIsEmpty(rows) ? null : { values, label: 'Documents published by month', summary: `Documents published by month: ${rows.map((r) => `${r.label} ${r.published}`).join(', ')}.`, floor: 0 },
  };
}

/** The six figures, in the order the page opens with them. */
export const heroTiles = (i: HeroInputs): TileModel[] => [scoreTile(i), attentionTile(i), documentsTile(i), reviewsTile(i), coverageTile(i), publishedTile(i)];

// ── section scores against the target ────────────────────────────────────────────────────────────────────────────────────

export interface SectionBar { key: string; name: string; score: number; weightPct: number; band: string; color: string; page: string }
export interface SectionChart { bars: SectionBar[]; /** the sections with nothing to score yet: not a bar, never a 0 */ noData: string[]; target: number }

/** The sections that have a score, weakest first, each coloured by the band it is in (strong from 80, fair from 60), and the ones that have none. */
export function sectionChart(card: Scorecard | undefined): SectionChart {
  const rows = sectionRows(card);
  const bars = rows.filter((r) => r.score !== null).map((r): SectionBar => {
    const band = bandOf(r.score);
    return { key: r.key, name: r.label, score: Math.round(r.score as number), weightPct: r.weightPct, band: band.label, color: toneColor(band.tone), page: r.page };
  }).sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  return { bars, noData: rows.filter((r) => r.score === null).map((r) => r.label), target: postureHead(card).target };
}

/** The bands the bars are coloured by, for the legend (the cut-offs of score-kit's scoreBand). */
export const BANDS: ReadonlyArray<{ key: string; label: string; color: string }> = [
  { key: 'strong', label: 'Strong, 80 and over', color: toneColor('success') },
  { key: 'fair', label: 'Fair, 60 to 79', color: toneColor('warning') },
  { key: 'weak', label: 'Weak, under 60', color: toneColor('danger') },
];

// ── documents by status, by type ─────────────────────────────────────────────────────────────────────────────────────────

export interface RankRow { key: string; label: string; value: number; color: string; href?: string }

/** The documents at each step of the approval flow (a step nobody is at says 0), then the states outside it that some document is in. The library opens on each. */
export function statusRows(summary: DocumentsSummary | undefined): RankRow[] {
  const by = summary?.by_status ?? {};
  const known = new Set<string>([...STAGE_ORDER, 'review_required', 'exception_applied', 'expired', 'archived']);
  const extra = Object.keys(by).filter((s) => !known.has(s) && isNum(by[s]) && by[s] > 0).sort();
  const outside = ['review_required', 'exception_applied', 'expired', 'archived', ...extra].filter((s) => isNum(by[s]) && by[s] > 0);
  return [...STAGE_ORDER, ...outside].map((status) => ({
    key: status, label: documentStatus.label(status), value: isNum(by[status]) ? by[status] : 0, color: toneColor(documentStatus.tone(status)), href: `${LIBRARY}?status=${encodeURIComponent(status)}`,
  }));
}

/** The kinds of document as the slices of a donut: the five biggest, the rest folded into Other. A kind opens the library on it. */
export function typeSlices(summary: DocumentsSummary | undefined): Slice[] {
  const by = summary?.by_type ?? {};
  const slices = Object.keys(by).filter((k) => isNum(by[k]) && by[k] > 0).map((k) => ({ key: k, label: statusLabel(k), value: by[k], href: `${LIBRARY}?type=${encodeURIComponent(k)}` }));
  return foldTail(slices, 5);
}

export const archivedCount = (summary: DocumentsSummary | undefined): number => (isNum(summary?.by_status?.archived) ? (summary?.by_status?.archived as number) : 0);

// ── classification and mappings ──────────────────────────────────────────────────────────────────────────────────────────

const CLASSES = ['public', 'internal', 'confidential', 'restricted'];

/** The documents by how sensitive they are, in order from public to restricted, one hue that darkens with the sensitivity (an ordered scale is not a set of kinds). */
export function classificationParts(summary: DocumentsSummary | undefined): Array<Slice & { href: string }> {
  const by = summary?.by_classification ?? {};
  const keys = [...CLASSES, ...Object.keys(by).filter((k) => !CLASSES.includes(k)).sort()].filter((k) => isNum(by[k]) && by[k] > 0);
  return keys.map((k, i) => ({ key: k, label: statusLabel(k), value: by[k], color: RAMP[Math.min(RAMP.length - 1, i + 1)], href: `${LIBRARY}?cls=${encodeURIComponent(k)}` }));
}

export interface MappingRows { /** the documents that are not archived: the scale of every bar */ of: number; rows: Array<{ key: string; label: string; value: number; text: string }> }

/** The documents linked to each kind of record, out of the documents that are not archived; null when the scorecard carries no mapping counts. */
export function mappingRows(card: Scorecard | undefined): MappingRows | null {
  const m = card?.sections?.mappings?.counts as Record<string, { documents?: unknown } | undefined> | undefined;
  const active = card?.sections?.documents?.counts?.active;
  if (!m || !isNum(active)) return null;
  if (active === 0) return { of: 0, rows: [] };
  const kinds: Array<[string, string]> = [['frameworks', 'Frameworks'], ['controls', 'Controls'], ['risks', 'Risks'], ['assets', 'Assets']];
  return {
    of: active,
    rows: kinds.filter(([k]) => isNum(m[k]?.documents)).map(([k, label]) => ({ key: k, label, value: m[k]?.documents as number, text: `${formatCount(m[k]?.documents as number)} of ${formatCount(active)}` })),
  };
}

// ── what lapses when ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface LapseRow { label: string; reviews: number | null; expiring: number | null }

export interface ExpiringAnswer { by_timeframe?: Record<string, number> }

/** Reviews falling due and documents reaching their expiry, in the windows the server counts (it counts each window from now, so the 31 to 60 days is the
 *  difference of two of its numbers), and what is past already: reviews overdue and documents that have expired. A number the server did not send is null. */
export function lapseRows(card: Scorecard | undefined, expiring: ExpiringAnswer | undefined, summary: DocumentsSummary | undefined): LapseRow[] {
  const r = card?.sections?.reviews?.counts as Record<string, unknown> | undefined;
  const e = expiring?.by_timeframe;
  const num = (v: unknown): number | null => (isNum(v) ? v : null);
  const diff = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : Math.max(0, a - b));
  const rv = { over: num(r?.overdue), d30: num(r?.due_30d), d60: num(r?.due_60d), d90: num(r?.due_90d) };
  const ex = { d30: num(e?.['30_days']), d60: num(e?.['60_days']), d90: num(e?.['90_days']) };
  const expired = num(summary?.by_status?.expired);
  return [
    { label: 'Past due', reviews: rv.over, expiring: expired },
    { label: '30 days', reviews: rv.d30, expiring: ex.d30 },
    { label: '60 days', reviews: diff(rv.d60, rv.d30), expiring: diff(ex.d60, ex.d30) },
    { label: '90 days', reviews: diff(rv.d90, rv.d60), expiring: diff(ex.d90, ex.d60) },
  ];
}

/** Nothing falls due or has lapsed: every number there is is 0 (and at least one number is there). */
export const lapseIsEmpty = (rows: readonly LapseRow[]): boolean => {
  const all = rows.flatMap((r) => [r.reviews, r.expiring]).filter((v): v is number => v !== null);
  return all.length > 0 && all.every((v) => v === 0);
};

// ── exceptions ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ExceptionsAnswer { total?: number; pending_approval?: number; approved?: number; expiring_soon?: number; by_status?: Record<string, number>; by_priority?: Record<string, number> }

const EXCEPTION_ORDER = ['draft', 'pending_approval', 'approved', 'rejected', 'revoked', 'expired'];
const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low'];

/** The exceptions by where they stand, along the route (draft, waiting, approved) and then how they ended, each in its status colour. */
export function exceptionParts(by: Record<string, number> | undefined): Slice[] {
  const keys = [...EXCEPTION_ORDER, ...Object.keys(by ?? {}).filter((k) => !EXCEPTION_ORDER.includes(k)).sort()];
  return keys.filter((k) => isNum(by?.[k]) && (by?.[k] as number) > 0)
    .map((k) => ({ key: k, label: exceptionStatus.label(k), value: by?.[k] as number, color: toneColor(exceptionStatus.tone(k)) }));
}

/** The exceptions by priority, the most serious first. */
export function priorityRows(by: Record<string, number> | undefined, color: string): RankRow[] {
  const keys = [...PRIORITY_ORDER, ...Object.keys(by ?? {}).filter((k) => !PRIORITY_ORDER.includes(k)).sort()];
  return keys.filter((k) => isNum(by?.[k]) && (by?.[k] as number) > 0).map((k) => ({ key: k, label: statusLabel(k), value: by?.[k] as number, color }));
}

// ── requests and actions ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface FlowBar { key: 'approvals' | 'attestations' | 'actions'; label: string; href: string; info: string; parts: Slice[]; total: number }

const DONE = STATUS.good;
const WAITING = STATUS.pending;
const OVERDUE = STATUS.bad;

const parts = (done: number, open: number, overdue: number): Slice[] => [
  { key: 'done', label: 'Done', value: done, color: DONE },
  { key: 'waiting', label: 'Waiting', value: Math.max(0, open - overdue), color: WAITING },
  { key: 'overdue', label: 'Overdue', value: overdue, color: OVERDUE },
];

/** Three things people are asked to do, each as one bar of what is done, what waits and what is late. A bar whose numbers the scorecard did not send is left out. */
export function flowBars(card: Scorecard | undefined): FlowBar[] {
  const c = (key: string): Record<string, unknown> | undefined => card?.sections?.[key]?.counts as Record<string, unknown> | undefined;
  const a = c('approvals');
  const t = c('attestations');
  const m = c('committees');
  const out: FlowBar[] = [];
  if (a && isNum(a.pending_steps) && isNum(a.overdue_steps)) {
    out.push({
      key: 'approvals', label: 'Reviews and approvals', href: '/governance/approvals', parts: parts((isNum(a.approved_90d) ? a.approved_90d : 0) + (isNum(a.rejected_90d) ? a.rejected_90d : 0), a.pending_steps, a.overdue_steps), total: 0,
      info: 'One request for each person asked. Done: decided in the last 90 days (approved or sent back). Waiting: asked and not yet due. Overdue: past the due date.',
    });
  }
  if (t && isNum(t.open) && isNum(t.overdue)) {
    out.push({
      key: 'attestations', label: 'Acknowledgements', href: '/governance/documents/attestation', parts: parts(isNum(t.completed) ? t.completed : 0, t.open, t.overdue), total: 0,
      info: 'One request for each person asked to acknowledge a document. Done: acknowledged in the last 12 months. Waiting: asked and not yet due. Overdue: past the due date.',
    });
  }
  if (m && isNum(m.open_actions) && isNum(m.overdue_actions)) {
    out.push({
      key: 'actions', label: 'Committee actions', href: '/governance/committees/actions', parts: parts(isNum(m.actions_completed) ? m.actions_completed : 0, m.open_actions, m.overdue_actions), total: 0,
      info: 'Actions given by the committees. Done: completed. Waiting: open and not yet due. Overdue: past the due date.',
    });
  }
  return out.map((b) => ({ ...b, total: b.parts.reduce((n, p) => n + p.value, 0) }));
}

/** Nothing has been asked of anyone yet: every bar is empty. */
export const flowIsEmpty = (bars: readonly FlowBar[]): boolean => bars.every((b) => b.total === 0);

// ── the groups: review health and where attention sits ───────────────────────────────────────────────────────────────────

/** The chart shows the weakest groups only (the table under it has them all): a bar for every one of 36 frameworks would be a wall. */
export const GROUP_BARS = 8;

export interface GroupStack { key: string; label: string; cells: Record<'current' | 'due' | 'overdue' | 'none', number>; href: string }

export const REVIEW_SERIES: ReadonlyArray<{ key: 'current' | 'due' | 'overdue' | 'none'; label: string; color: string }> = [
  { key: 'current', label: REVIEW_BUCKET_LABEL.ok, color: STATUS.good },
  { key: 'due', label: REVIEW_BUCKET_LABEL.due_soon, color: STATUS.warn },
  { key: 'overdue', label: REVIEW_BUCKET_LABEL.overdue, color: STATUS.bad },
  { key: 'none', label: REVIEW_BUCKET_LABEL.unscheduled, color: STATUS.neutral },
];

/** Where the review dates of each group's documents stand (the groups come weakest first, as the server sends them). A document is in one state only. */
export function groupStacks(rows: readonly PostureApiRow[], by: GroupBy, keep = GROUP_BARS): GroupStack[] {
  return rows.slice(0, keep).map((r) => ({
    key: r.id === null ? 'none' : String(r.id), label: r.name, href: groupHref(by, r.id),
    cells: { current: r.current, due: r.due, overdue: r.overdue, none: r.no_review_date },
  }));
}

/** The groups that have a review owed on any document: a group with none draws no bar (its documents are drafts or archived). */
export const hasReviewBars = (stacks: readonly GroupStack[]): boolean => stacks.some((s) => s.cells.current + s.cells.due + s.cells.overdue + s.cells.none > 0);

export const ATTENTION_COLUMNS = [
  { key: 'overdue_reviews', label: 'Overdue', noun: 'overdue reviews' },
  { key: 'awaiting_approval', label: 'Approval', noun: 'documents awaiting approval' },
  { key: 'expiring_30d', label: 'Expiring', noun: 'documents expiring in 30 days' },
  { key: 'exceptions', label: 'Exceptions', noun: 'exceptions pending or expiring' },
] as const;

export interface GroupHeat { rows: string[]; cols: string[]; cells: number[][]; hrefs: Array<Array<string | undefined>> }

const clip = (name: string, n: number): string => (name.length > n ? `${name.slice(0, n - 1)}…` : name);

/** The same groups against the four kinds of attention (the posture's own split): how many of each. A cell opens the library on the group where the library
 *  can list exactly those documents (overdue reviews, documents awaiting approval, documents expiring in 30 days); exceptions have no list, so no link. */
export function groupHeat(rows: readonly PostureApiRow[], by: GroupBy, keep = GROUP_BARS, width = 30): GroupHeat {
  const shown = rows.slice(0, keep);
  const names: string[] = [];
  shown.forEach((r) => {
    let name = clip(r.name, width);
    if (names.includes(name)) name = `${name} (${r.id === null ? 'none' : r.id})`;            // two groups of one name stay two rows
    names.push(name);
  });
  const q = (r: PostureApiRow, extra: string): string => `${groupHref(by, r.id)}&${extra}`;
  return {
    rows: names,
    cols: ATTENTION_COLUMNS.map((c) => c.label),
    cells: shown.map((r) => ATTENTION_COLUMNS.map((c) => r.attention[c.key])),
    hrefs: shown.map((r) => [q(r, 'review=overdue'), q(r, 'status=pending_review,pending_approval'), q(r, 'expiry=30d'), undefined]),
  };
}

/** What the chart card says under its title: how many of the groups it draws. */
export const groupsDrawn = (drawn: number, total: number, noun: string): string =>
  total > drawn ? `Weakest ${formatCount(drawn)} of ${formatCount(total)} ${noun}` : `${formatCount(total)} ${noun}`;
