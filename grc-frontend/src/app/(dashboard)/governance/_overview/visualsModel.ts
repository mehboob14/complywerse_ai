// What the Governance Overview's graphics draw, without React, so `node --test` checks it (visualsModel.test.ts): the five figures the Summary opens with
// (each with its state, its change and the line it has over time), and the rows, slices and series of the cards that rest on the scorecard, the throughput, the
// expiring-soon and exceptions answers and the posture groups. (The cards of the documents, scoped to a department, are docs/_summary.ts.) Nothing here asks for
// anything, scores anything or invents a number: a figure is the server's, or a sum or a difference of the server's (the (i) of the card says which), and
// a series that cannot be read is `null` (a dash in the table), never 0. The kit's own pure rules are components/overview/charts/chartModel.ts.
import { formatCount } from '../../../../lib/format.ts';
import { TONE, exceptionStatus, type Tone } from '../../../../lib/status.ts';
import type { AreaTileItem, AreaTone } from '../../../../components/overview/charts/areaModel.ts';
import type { Slice } from '../../../../components/overview/charts/chartModel.ts';
import { LIBRARY, figureHref, type Overview } from './docs/_model.ts';
import { severity } from './docs/_summary.ts';
import { viewHref } from './docs/_views.ts';
import { isRefused, monthLabel, trendIsEmpty, trendTotals, type Load, type Scorecard, type TrendPoint, type TrendRow } from './overviewModel.ts';
import { bandOf, groupHref, postureHead, sectionRows, trendAlt, type GroupBy, type PostureApiRow } from './postureModel.ts';

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

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

// ── the scope ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** What a card that the server cannot narrow to a department says when one is picked: it is still the whole organisation, said on the card and in its (i), never silently. */
export const WHOLE_ORGANISATION = 'Whole organisation';
export const wholeOrganisation = (scoped: boolean, info: string): { meta?: string; info: string } =>
  (scoped ? { meta: WHOLE_ORGANISATION, info: `${info} Always the whole organisation, whatever department is picked.` } : { info });

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

// ── the five figures ─────────────────────────────────────────────────────────────────────────────────────────────────────

export type TileState = 'ready' | 'loading' | 'error' | 'denied' | 'none';
export type TileTone = 'default' | 'success' | 'warning' | 'danger';
export type ChangeTone = 'good' | 'bad' | 'neutral';
export type SourceKey = 'scorecard' | 'doc' | 'trends';

export interface TileModel {
  key: 'score' | 'documents' | 'coverage' | 'attention' | 'published';
  label: string;
  state: TileState;
  /** the figure as text; null: nothing is recorded (the tile says so, never 0) */
  value: string | null;
  unit?: string;
  note?: string;
  info?: string;
  /** an address (the page adds `?from=` to the ones that leave it), or a `#anchor` */
  href?: string;
  linkLabel?: string;
  tone: TileTone;
  delta: { text: string; direction: 'up' | 'down' | 'flat'; tone: ChangeTone; since?: string } | null;
  spark: { values: Array<number | null>; label: string; summary: string; floor?: number } | null;
  /** 0 to 100, for a share */
  progress: number | null;
  /** the thin severity bar of the one "Needs attention" tile */
  severity: Slice[] | null;
  /** the requests to ask again when the tile failed */
  retry: SourceKey[];
  failTitle: string;
}

export interface HeroInputs {
  scorecard: Answer<Scorecard>;
  /** the document figures of the scope the person picked (GET /governance/document-overview) */
  doc: Answer<Overview>;
  trends: Answer<TrendsAnswer>;
  /** a department is picked: the figures the server cannot narrow to it say they are the whole organisation */
  scoped: boolean;
  now: Date;
}

const GRADE_TONE: Record<string, TileTone> = { excellent: 'success', good: 'success', fair: 'warning', poor: 'danger' };

function base(key: TileModel['key'], label: string, failTitle: string, retry: SourceKey[]): TileModel {
  return { key, label, state: 'ready', value: null, tone: 'default', delta: null, spark: null, progress: null, severity: null, retry, failTitle };
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

/** The tile that carries the scope note: the score, the coverage and the throughput are the whole organisation's. */
const whole = (i: HeroInputs, t: TileModel): Pick<TileModel, 'note' | 'info'> => {
  const said = wholeOrganisation(i.scoped, t.info ?? '');
  return { info: said.info.trim(), note: i.scoped ? [t.note, WHOLE_ORGANISATION].filter(Boolean).join(' · ') : t.note };
};

function scoreTile(i: HeroInputs): TileModel {
  const t = base('score', 'Governance score', "Couldn't load the score", ['scorecard']);
  const w = waiting(t, i.scorecard);
  if (w) return w;
  const head = postureHead(i.scorecard.data);
  if (head.score === null) return { ...t, state: 'none', info: 'Nothing to score yet: it appears once there are documents, reviews or approvals to measure.' };
  const values = head.trend.map((p) => p.value);
  const shown: TileModel = {
    ...t,
    value: String(Math.round(head.score)),
    unit: '/ 100',
    note: `${head.grade ? `${head.grade.label} · ` : ''}target ${head.target}`,
    info: 'The weighted mean of the section scores, as the server computes it. The line is the score at the end of each month so far; it builds up as the months pass.',
    href: '#section-scores',
    linkLabel: `Governance score ${Math.round(head.score)} out of 100. Go to the section scores`,
    tone: head.grade ? (GRADE_TONE[head.grade.label.toLowerCase()] ?? 'default') : 'default',
    delta: scoreDelta(i.scorecard.data),
    spark: values.length > 1 ? { values, label: 'Governance score by month', summary: trendAlt(head.trend), floor: 0 } : null,
    progress: Math.max(0, Math.min(100, head.score)),
  };
  return { ...shown, ...whole(i, shown) };
}

function documentsTile(i: HeroInputs): TileModel {
  const t = base('documents', 'Documents', "Couldn't load the documents", ['doc']);
  const w = waiting(t, i.doc);
  if (w) return w;
  const d = i.doc.data as Overview;
  const archived = d.totals.archived;
  return {
    ...t,
    value: formatCount(d.totals.documents),
    unit: d.totals.documents === 1 ? 'document' : 'documents',
    note: archived > 0 ? `${formatCount(archived)} archived` : undefined,
    info: 'Documents that are not archived, in the department picked and everything under it.',
    href: figureHref(d, 'totals.documents') ?? LIBRARY,
    linkLabel: `${formatCount(d.totals.documents)} documents. Open the library`,
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
  const shown: TileModel = {
    ...t,
    value: `${Math.round(metric.score)}%`,
    note: of === 0 ? 'No documents to map yet' : `${formatCount(mapped)} of ${formatCount(of)} mapped`,
    info: metric.formula,
    href: '/governance/mappings',
    linkLabel: `Coverage ${Math.round(metric.score)} percent. Open the mappings`,
    progress: Math.max(0, Math.min(100, metric.score)),
  };
  return { ...shown, ...whole(i, shown) };
}

/** The one "Needs attention" tile: the documents that something is wrong with, counted once, and under them how much of it is urgent. It opens the board, which lists them. */
function attentionTile(i: HeroInputs): TileModel {
  const t = base('attention', 'Needs attention', "Couldn't load what needs attention", ['doc']);
  const w = waiting(t, i.doc);
  if (w) return w;
  const d = i.doc.data as Overview;
  const s = severity(d);
  const kinds = s.parts.reduce((n, p) => n + p.value, 0);
  return {
    ...t,
    value: formatCount(s.documents),
    unit: s.documents === 1 ? 'document' : 'documents',
    tone: s.documents > 0 ? 'warning' : 'success',
    note: s.documents === 0 ? 'Nothing is stuck or late' : kinds > 0 ? `${Math.round((s.parts[0].value / kinds) * 100)}% urgent` : undefined,
    info: 'Documents that are stuck in a stage, late, on hold, without an owner, expired or under an exception, each counted once. The bar splits the kinds into urgent and to follow up. Opens the board.',
    href: viewHref(d.scope.value, 'board'),
    linkLabel: `${formatCount(s.documents)} documents need attention. Open the board`,
    severity: s.documents > 0 ? s.parts : null,
  };
}

function publishedTile(i: HeroInputs): TileModel {
  const t = base('published', 'Published, 6 months', "Couldn't load the throughput", ['trends']);
  const w = waiting(t, i.trends);
  if (w) return w;
  const rows = monthSeries(i.trends.data, i.now);
  const totals = trendTotals(rows);
  const values = rows.map((r) => r.published);
  const shown: TileModel = {
    ...t,
    value: formatCount(totals.published),
    note: `${formatCount(totals.created)} created${totals.liveRate === null ? '' : ` · ${totals.liveRate}% published`}`,
    info: 'Documents published in the last six calendar months, month by month in the line. The share is the documents published in these months out of the documents created in them.',
    href: `${LIBRARY}?status=published`,
    linkLabel: `${formatCount(totals.published)} documents published in six months. Open the published documents`,
    spark: trendIsEmpty(rows) ? null : { values, label: 'Documents published by month', summary: `Documents published by month: ${rows.map((r) => `${r.label} ${r.published}`).join(', ')}.`, floor: 0 },
  };
  return { ...shown, ...whole(i, shown) };
}

/** The five figures, in the order the Summary opens with them. */
export const heroTiles = (i: HeroInputs): TileModel[] => [scoreTile(i), documentsTile(i), coverageTile(i), attentionTile(i), publishedTile(i)];

// ── section scores ───────────────────────────────────────────────────────────────────────────────────────────────────────

const AREA_TONE: Partial<Record<Tone, AreaTone>> = { success: 'good', warning: 'warn', danger: 'bad' };
/** The words the section tiles' colours carry (the bands of score-kit: strong from 80, fair from 60). */
export const SECTION_WORDS = { good: 'Strong', warn: 'Fair', bad: 'Weak', neutral: 'No data' } as const;

/** One small tile for each section the scorecard carries, in the breakdown's order: its score in its band's colour (a section with nothing to score is "Not scored", never 0), opening the page that lists what it counts. */
export function sectionTiles(card: Scorecard | undefined): AreaTileItem[] {
  return sectionRows(card).map((r): AreaTileItem => ({ key: r.key, label: r.label, value: r.score, tone: AREA_TONE[r.band.tone] ?? 'neutral', href: r.page }));
}

/** The target the section scores are measured against (the server's). */
export const sectionTarget = (card: Scorecard | undefined): number => postureHead(card).target;

// ── what expires when ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ExpiringAnswer { by_timeframe?: Record<string, number> }
export interface ExpiringRow { key: string; label: string; value: number; href?: string }

/** Documents reaching their expiry date, in the windows the server counts (it counts each window from now, so the 31 to 60 days is the difference of two of its numbers).
 *  The first window opens the library on it; the others have no filter, so no link. Windows the server did not send are left out, never 0. */
export function expiringRows(expiring: ExpiringAnswer | undefined): ExpiringRow[] {
  const e = expiring?.by_timeframe;
  const d30 = isNum(e?.['30_days']) ? e?.['30_days'] as number : null;
  const d60 = isNum(e?.['60_days']) ? e?.['60_days'] as number : null;
  const d90 = isNum(e?.['90_days']) ? e?.['90_days'] as number : null;
  const diff = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : Math.max(0, a - b));
  const rows: Array<{ key: string; label: string; value: number | null; href?: string }> = [
    { key: '30', label: 'Within 30 days', value: d30, href: `${LIBRARY}?expiry=30d` },
    { key: '60', label: '31 to 60 days', value: diff(d60, d30) },
    { key: '90', label: '61 to 90 days', value: diff(d90, d60) },
  ];
  return rows.filter((r): r is ExpiringRow => r.value !== null);
}

/** Nothing reaches its expiry in the next 90 days: every number there is is 0 (and at least one is there). */
export const expiringIsEmpty = (rows: readonly ExpiringRow[]): boolean => rows.length > 0 && rows.every((r) => r.value === 0);

// ── exceptions ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ExceptionsAnswer { total?: number; pending_approval?: number; approved?: number; expiring_soon?: number; by_status?: Record<string, number>; by_priority?: Record<string, number> }

const EXCEPTION_ORDER = ['draft', 'pending_approval', 'approved', 'rejected', 'revoked', 'expired'];

/** The exceptions by where they stand, along the route (draft, waiting, approved) and then how they ended, each in its status colour. */
export function exceptionParts(by: Record<string, number> | undefined): Slice[] {
  const keys = [...EXCEPTION_ORDER, ...Object.keys(by ?? {}).filter((k) => !EXCEPTION_ORDER.includes(k)).sort()];
  return keys.filter((k) => isNum(by?.[k]) && (by?.[k] as number) > 0)
    .map((k) => ({ key: k, label: exceptionStatus.label(k), value: by?.[k] as number, color: toneColor(exceptionStatus.tone(k)) }));
}

// ── the groups: where attention sits ─────────────────────────────────────────────────────────────────────────────────────

/** The chart shows the weakest groups only (the table under it has them all): a bar for every one of 36 frameworks would be a wall. */
export const GROUP_BARS = 8;

/** The kinds of attention the heat table splits: the overdue reviews are the framework table's own "Overdue" column beside it, so they are not drawn twice. */
export const ATTENTION_COLUMNS = [
  { key: 'awaiting_approval', label: 'Approval', noun: 'documents awaiting approval' },
  { key: 'expiring_30d', label: 'Expiring', noun: 'documents expiring in 30 days' },
  { key: 'exceptions', label: 'Exceptions', noun: 'exceptions pending or expiring' },
] as const;

export interface GroupHeat { rows: string[]; cols: string[]; cells: number[][]; hrefs: Array<Array<string | undefined>> }

const clip = (name: string, n: number): string => (name.length > n ? `${name.slice(0, n - 1)}…` : name);

/** The groups against three kinds of attention (the posture's own split, less the overdue reviews): how many of each. A cell opens the library on the group where the library
 *  can list exactly those documents (documents awaiting approval, documents expiring in 30 days); exceptions have no list, so no link. */
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
    hrefs: shown.map((r) => [q(r, 'status=pending_review,pending_approval'), q(r, 'expiry=30d'), undefined]),
  };
}

/** What the chart card says under its title: how many of the groups it draws. */
export const groupsDrawn = (drawn: number, total: number, noun: string): string =>
  total > drawn ? `Weakest ${formatCount(drawn)} of ${formatCount(total)} ${noun}` : `${formatCount(total)} ${noun}`;
