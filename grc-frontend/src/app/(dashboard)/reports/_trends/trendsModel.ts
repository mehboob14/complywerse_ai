// Trends: what the board decides, as pure functions apart from React so `node --test` can pin them (trendsModel.test.ts). The words of a figure's movement, which figures a filter keeps and in
// what order, the date a change is measured from (the server's own rule), the sentence a chart is summed up in, the shape of a sparkline, the rows of the tables that stand beside the charts,
// and whether a target a person typed makes sense. The cards come from `GET /reporting/trends/overview`; nothing here talks to the server (_reports/trends.ts does).
import { formatDate } from '../../../../lib/format.ts';
import { sortRows, type SortState } from '../../../../components/ui/ds/tableModel.ts';

export type Unit = 'pct' | 'score' | 'count' | 'days';
export type Direction = 'up_good' | 'down_good' | 'neutral';
export type Rag = 'ok' | 'warn' | 'critical' | 'none';

export interface TrendPoint { date: string; value: number | null }

/** A metric's card in the overview / its detail: the backend returns this shape. `customized`, `default_target` and `default_warn` are additive (a server older than them leaves them out). */
export interface TrendCard {
  key: string;
  label: string;
  module: string;
  module_label: string;
  unit: Unit;
  direction: Direction;
  dimension: string | null;
  definition: string;
  target: number | null;
  warn: number | null;
  critical: number | null;
  current: number | null;
  previous: number | null;
  delta_abs: number | null;
  delta_pct: number | null;
  status: Rag;
  as_of: string | null;
  points: TrendPoint[];
  dimension_value?: string;
  customized?: boolean;
  default_target?: number | null;
  default_warn?: number | null;
}

export interface OverviewResp { days: number; cards: TrendCard[] }
export interface BreakdownSeries { key: string; points: TrendPoint[] }
export interface BreakdownResp { metric: string; dimension: string | null; label: string; unit: Unit; series: BreakdownSeries[] }
export interface TargetBody { metric: string; dimension?: string; dimension_value?: string; target: number | null; warn: number | null; critical: number | null }

// ── numbers and dates ────────────────────────────────────────────────────────────────────────────
export const round1 = (v: number): number => Math.round(v * 10) / 10;
const EN = 'en-US';                                                    // every viewer reads the same digits (lib/format.ts does the same)

/** A value in its unit: "55%", "62.4", "9.5d", "1,204"; "—" for no value. */
export function formatValue(v: number | null | undefined, unit: Unit): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (unit === 'pct') return `${round1(v)}%`;
  if (unit === 'score') return `${round1(v)}`;
  if (unit === 'days') return `${round1(v)} days`;
  return Math.round(v).toLocaleString(EN);
}

/** The unit after a big figure: "%", "/100", "days"; nothing for a count. */
export function unitTag(unit: Unit): string {
  return unit === 'pct' ? '%' : unit === 'score' ? '/100' : unit === 'days' ? 'days' : '';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "12 Nov" for an axis tick; '' for no date. (The full date, "12 Nov 2026", is formatDay.) */
export function axisDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const p = iso.slice(0, 10).split('-');
  return p.length < 3 || !MONTHS[+p[1] - 1] ? '' : `${+p[2]} ${MONTHS[+p[1] - 1]}`;
}
/** "12 Nov 2026" for a snapshot day (a calendar day: it never moves with the viewer's zone). */
export const formatDay = (iso: string | null | undefined): string => formatDate(iso ? iso.slice(0, 10) : null, { calendar: true });

const DAY_MS = 86_400_000;
const dayNumber = (iso: string): number => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY_MS; };
/** Whole days from `from` to `to` (two ISO days). */
export const daysBetween = (from: string, to: string): number => Math.round(dayNumber(to) - dayNumber(from));

// ── ranges ───────────────────────────────────────────────────────────────────────────────────────
export const RANGES = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 180, label: '6 months' },
  { days: 365, label: '1 year' },
] as const;
export const DEFAULT_RANGE = 180;
export const rangeLabel = (days: number): string => RANGES.find((r) => r.days === days)?.label ?? `${days} days`;

// ── status ───────────────────────────────────────────────────────────────────────────────────────
/** The order "Needs attention first" lists the statuses in: off target, watch, on target, then the figures nobody set a target for. */
export const RAG_ORDER: readonly Rag[] = ['critical', 'warn', 'ok', 'none'];
const rank = (s: Rag): number => { const i = RAG_ORDER.indexOf(s); return i < 0 ? RAG_ORDER.length : i; };

export function statusCounts(cards: readonly TrendCard[]): Record<Rag, number> {
  const out: Record<Rag, number> = { critical: 0, warn: 0, ok: 0, none: 0 };
  for (const c of cards) out[RAG_ORDER.includes(c.status) ? c.status : 'none'] += 1;
  return out;
}

/** The cards a status filter keeps; no status chosen keeps all of them. */
export function filterCards(cards: readonly TrendCard[], statuses: readonly string[]): TrendCard[] {
  return statuses.length === 0 ? cards.slice() : cards.filter((c) => statuses.includes(c.status));
}

export type Order = 'module' | 'attention';

/** `module` is the order the server sends (the catalog's: modules in their order, figures in theirs); `attention` puts off target first, then watch, then on target, then no target; ties keep the catalog order. */
export function orderCards(cards: readonly TrendCard[], order: Order): TrendCard[] {
  if (order !== 'attention') return cards.slice();
  return cards.map((card, index) => ({ card, index })).sort((a, b) => rank(a.card.status) - rank(b.card.status) || a.index - b.index).map((x) => x.card);
}

/** The cards in the order a column of the table asks for: the figure's name, the module (in the catalog's order), the value now, the change, or the status (off target first). A card with nothing in the column is last. */
export function sortCards(cards: readonly TrendCard[], sort: SortState): TrendCard[] {
  const modules: string[] = [];
  for (const c of cards) if (!modules.includes(c.module)) modules.push(c.module);
  return sortRows(cards, sort, (c, key) => (key === 'figure' ? c.label : key === 'module' ? modules.indexOf(c.module) : key === 'now' ? c.current : key === 'change' ? c.delta_abs : key === 'status' ? rank(c.status) : null));
}

export interface ModuleGroup { module: string; label: string; cards: TrendCard[] }
/** The cards by module, in the order the modules first appear. */
export function groupByModule(cards: readonly TrendCard[]): ModuleGroup[] {
  const groups: ModuleGroup[] = [];
  const byModule = new Map<string, ModuleGroup>();
  for (const c of cards) {
    let g = byModule.get(c.module);
    if (!g) { g = { module: c.module, label: c.module_label, cards: [] }; byModule.set(c.module, g); groups.push(g); }
    g.cards.push(c);
  }
  return groups;
}

// ── history ──────────────────────────────────────────────────────────────────────────────────────
/** True when a metric has enough history to draw a line (two real points). */
export const hasSeries = (points: readonly TrendPoint[] | undefined): boolean => !!points && points.filter((p) => p.value != null).length >= 2;

/** Real data points across a set of cards: 0 means nothing has been captured yet. */
export const totalPoints = (cards: readonly TrendCard[]): number => cards.reduce((n, c) => n + (c.points ? c.points.filter((p) => p.value != null).length : 0), 0);

/** The newest day any card has a value for (an ISO day), or null. */
export function lastCaptured(cards: readonly TrendCard[]): string | null {
  let last: string | null = null;
  for (const c of cards) if (c.as_of && (last === null || c.as_of.slice(0, 10) > last)) last = c.as_of.slice(0, 10);
  return last;
}

/** Nothing captures by itself (no scheduler runs), so the board says when the newest values are old. More than a week is "old". */
export const STALE_AFTER_DAYS = 7;
export function staleDays(last: string | null, today: string): number | null {
  if (!last) return null;
  const n = daysBetween(last, today);
  return n > STALE_AFTER_DAYS ? n : null;
}

/** The point a change is measured from: the same rule as the server (`_series_stats`): the last point at or before 30 days before the newest, else the first. null with fewer than two points. */
export function previousPoint(points: readonly TrendPoint[]): TrendPoint | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1].date.slice(0, 10);
  let found: TrendPoint | null = null;
  for (const p of points.slice(0, -1)) if (daysBetween(p.date, last) >= 30) found = p;
  return found && found.value != null ? found : points[0];
}

// ── how a figure moved ───────────────────────────────────────────────────────────────────────────
// The colours are the kit's tokens as hex (an SVG attribute cannot read a class): --ds-success, --ds-danger, --ds-warning, --ds-fg-muted, --ds-primary; each is 4.5:1 or better on white.
export const INK = { good: '#08794f', bad: '#b42318', warn: '#9a5007', muted: '#586472', primary: '#0f766e', grid: '#e1e6eb', border: '#c3ccd5' } as const;

export interface DeltaView {
  arrow: 'up' | 'down' | 'flat';
  /** "+3.2 pp", "−12", "no change", "—" */
  text: string;
  /** whether the movement is the good way for this figure; null for a figure with no direction, or no change */
  good: boolean | null;
  /** "better" or "worse": the movement in words, so colour is never the only thing that says it */
  verdict: 'better' | 'worse' | null;
  color: string;
}

/** A card's change from the earlier value: arrow, signed amount and whether it is the good way (a drop in open vulnerabilities is better). */
export function deltaView(card: Pick<TrendCard, 'delta_abs' | 'previous' | 'direction' | 'unit'>): DeltaView {
  const d = card.delta_abs;
  if (d == null || card.previous == null) return { arrow: 'flat', text: '—', good: null, verdict: null, color: INK.muted };
  const arrow: DeltaView['arrow'] = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
  let good: boolean | null = null;
  if (d !== 0) {
    if (card.direction === 'up_good') good = d > 0;
    else if (card.direction === 'down_good') good = d < 0;
  }
  const text = d === 0 ? 'no change' : signedChange(d, card.unit);
  return { arrow, text, good, verdict: good == null ? null : good ? 'better' : 'worse', color: good == null ? INK.muted : good ? INK.good : INK.bad };
}

/** A change between two values, signed: "+3.2 pp" (percentage points read clearer than "%"), "−12", "+1,500", "+2.5 days". */
export function signedChange(d: number, unit: Unit): string {
  const suffix = unit === 'pct' ? ' pp' : unit === 'days' ? ' days' : '';
  const mag = unit === 'count' ? Math.abs(Math.round(d)).toLocaleString(EN) : `${Math.abs(round1(d))}${suffix}`;
  return `${d < 0 ? '−' : '+'}${mag}`;
}

/** "since 12 Oct 2026" (the day the change is measured from), or '' when there is no earlier value. */
export function sinceWords(points: readonly TrendPoint[]): string {
  const p = previousPoint(points);
  return p ? `since ${formatDay(p.date)}` : '';
}

/** What a figure's direction means, in words: "Lower is better". */
export const directionWords = (d: Direction): string => (d === 'down_good' ? 'Lower is better' : d === 'up_good' ? 'Higher is better' : 'No better or worse direction');

/** What the two levels of a target mean for a figure, in words: it sits under the "Warn at" box of the editor. */
export function levelsHint(direction: Direction): string {
  if (direction === 'up_good') return 'At or above the target is On target. Between the warning level and the target is Watch. Below the warning level is Off target.';
  if (direction === 'down_good') return 'At or below the target is On target. Between the target and the warning level is Watch. Above the warning level is Off target.';
  return 'This figure has no better or worse direction, so its target is drawn on the chart but does not give it a status.';
}

/** One sentence that sums a chart up for anyone who cannot see it: "From 62 on 12 Aug 2026 to 55 on 9 Nov 2026 (target 40)." */
export function summarySentence(card: Pick<TrendCard, 'points' | 'unit' | 'target' | 'label'>): string {
  const real = card.points.filter((p) => p.value != null);
  if (real.length < 2) return '';
  const first = real[0];
  const last = real[real.length - 1];
  const target = card.target != null ? ` (target ${formatValue(card.target, card.unit)})` : '';
  return `${card.label}: from ${formatValue(first.value, card.unit)} on ${formatDay(first.date)} to ${formatValue(last.value, card.unit)} on ${formatDay(last.date)}${target}.`;
}

// ── sparkline ────────────────────────────────────────────────────────────────────────────────────
export interface Spark { line: string; area: string; last: { x: number; y: number }; targetY: number | null }

/** The drawing of a sparkline in a `width` x `height` box, or null with fewer than two points (the card says there is not enough history). Counts are not clamped to 0..100 the way a percentage is: the box fits the values. */
export function sparkPath(points: readonly TrendPoint[], target: number | null, width: number, height: number): Spark | null {
  const pts = points.filter((p): p is { date: string; value: number } => p.value != null && Number.isFinite(p.value));
  if (pts.length < 2) return null;
  const ys = pts.map((p) => p.value);
  const refs = target != null ? ys.concat(target) : ys;
  let lo = Math.min(...refs);
  let hi = Math.max(...refs);
  if (hi - lo < 1e-9) hi = lo + 1;
  const pad = (hi - lo) * 0.14;
  lo -= pad;
  hi += pad;
  const x = (i: number) => (width * i) / (pts.length - 1);
  const y = (v: number) => height - ((v - lo) / (hi - lo)) * height;
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  return { line, area: `${line} L${x(pts.length - 1).toFixed(1)},${height} L0,${height} Z`, last: { x: x(pts.length - 1), y: y(pts[pts.length - 1].value) }, targetY: target != null ? y(target) : null };
}

/** The y range of the big chart: the values and the reference lines with some air; a percentage or score stays inside 0..100, a count or a number of days starts at 0 when it can. */
export function yDomain(values: readonly number[], unit: Unit, extra: ReadonlyArray<number | null> = []): [number, number] {
  const all = values.concat(extra.filter((v): v is number => v != null));
  if (!all.length) return [0, unit === 'pct' || unit === 'score' ? 100 : 1];
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (hi - lo < 1e-9) hi = lo + 1;
  const pad = (hi - lo) * 0.15;
  lo -= pad;
  hi += pad;
  if (unit === 'pct' || unit === 'score') { lo = Math.max(0, lo); hi = Math.min(100, hi); } else { lo = Math.min(0, lo); }
  return [Math.floor(lo), Math.ceil(hi)];
}

// ── the tables that stand beside the charts ──────────────────────────────────────────────────────
export interface ValueRow { date: string; day: string; value: string }
/** Every captured value, newest first: the visible twin of the line chart. A day with no value is left out (it is a gap in the line, not a 0). */
export function valueRows(points: readonly TrendPoint[], unit: Unit): ValueRow[] {
  return points.filter((p) => p.value != null).map((p) => ({ date: p.date.slice(0, 10), day: formatDay(p.date), value: formatValue(p.value, unit) })).reverse();
}

export interface SliceRow { key: string; latest: number | null; first: number | null; change: number | null }
/** One row per slice of a breakdown (EVERY slice: the chart draws the largest few, this table lists them all), largest latest value first; a slice with no value is last. */
export function sliceRows(series: readonly BreakdownSeries[]): SliceRow[] {
  const rows = series.map((s) => {
    const real = s.points.filter((p) => p.value != null);
    const latest = real.length ? (real[real.length - 1].value as number) : null;
    const first = real.length ? (real[0].value as number) : null;
    return { key: s.key, latest, first, change: latest != null && first != null && real.length > 1 ? latest - first : null };
  });
  return rows.map((row, index) => ({ row, index })).sort((a, b) => (a.row.latest == null ? 1 : 0) - (b.row.latest == null ? 1 : 0) || (b.row.latest ?? 0) - (a.row.latest ?? 0) || a.index - b.index).map((x) => x.row);
}

/** A slice's name for a person: "critical" is "Critical", "in_progress" is "In progress"; a name that already has capitals, digits first or spaces (a framework's title) is left as written. */
export function sliceLabel(key: string): string {
  return /^[a-z][a-z0-9_]*$/.test(key) ? key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ') : key;
}

/** The chart draws at most this many slices (one colour each, in a fixed order); the table lists all of them. */
export const MAX_SLICES = 8;
/** The slices the chart draws: the largest by latest value, kept in the table's order; `hidden` is how many the chart leaves out. */
export function chartSlices(rows: readonly SliceRow[]): { keys: string[]; hidden: number } {
  return { keys: rows.slice(0, MAX_SLICES).map((r) => r.key), hidden: Math.max(0, rows.length - MAX_SLICES) };
}

// ── the target a person types ────────────────────────────────────────────────────────────────────
export interface TargetCheck { target: number | null; warn: number | null; error: string | null }

/** Reads the two boxes of the target editor. A blank box is "none". A box that is not a number is an error (it used to be sent as NaN). For a figure where higher is better the warning level sits BELOW the target; where lower is better it sits ABOVE it:
 *  the other way round, the warning level could never be reached and the colour would jump straight from on target to off target. */
export function checkTarget(direction: Direction, targetText: string, warnText: string): TargetCheck {
  const read = (text: string): number | null | 'bad' => { const t = text.trim(); if (t === '') return null; const n = Number(t); return Number.isFinite(n) ? n : 'bad'; };
  const target = read(targetText);
  const warn = read(warnText);
  if (target === 'bad') return { target: null, warn: null, error: 'The target must be a number.' };
  if (warn === 'bad') return { target, warn: null, error: 'The warning level must be a number.' };
  if (warn != null && target == null) return { target, warn, error: 'Set a target as well, or clear the warning level: a warning level needs a target to be measured against.' };
  if (target != null && warn != null) {
    if (direction === 'up_good' && warn > target) return { target, warn, error: 'Where higher is better, the warning level must not be above the target.' };
    if (direction === 'down_good' && warn < target) return { target, warn, error: 'Where lower is better, the warning level must not be below the target.' };
  }
  return { target, warn, error: null };
}

/** The two boxes as text, from a card ("" for none). */
export const targetBoxes = (card: Pick<TrendCard, 'target' | 'warn'>): { target: string; warn: string } => ({ target: card.target != null ? String(card.target) : '', warn: card.warn != null ? String(card.warn) : '' });

/** True when the boxes hold something other than the card's target and warning level. */
export function targetChanged(card: Pick<TrendCard, 'target' | 'warn'>, targetText: string, warnText: string): boolean {
  const was = targetBoxes(card);
  return targetText.trim() !== was.target || warnText.trim() !== was.warn;
}
