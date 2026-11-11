// What the Overview charts decide, apart from React so `node --test` can pin it (chartModel.test.ts): how a long list is folded into "Other", the whole-number
// shares that add up to 100, what a trend says in words, how a figure's change reads (up is good for some figures and bad for others), the geometry of a
// sparkline and a score ring, and the step of a heatmap cell. Nothing here knows a module or draws anything.
import { seriesColor, OTHER } from './palette.ts';
import { formatCount } from '../../../lib/format.ts';
import type { ChartData } from '../../ui/ds/chartText.ts';

export interface Slice {
  key: string;
  label: string;
  value: number;
  /** a hue of its own; the chart gives one from SERIES (in order) when there is none */
  color?: string;
  /** where the slice opens the records it counts */
  href?: string;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Slices with a number above 0, a negative or missing value dropped: a chart never draws a bar the table cannot give. */
export const positive = <T extends { value: number }>(rows: readonly T[]): T[] => rows.filter((r) => finite(r.value) && r.value > 0);

/** The sum of the finite numbers. */
export const sum = (values: readonly (number | null | undefined)[]): number => values.reduce<number>((a, v) => (finite(v) ? a + v : a), 0);

/** Gives each slice without a colour the next hue of SERIES, in order, never cycled (a slice past the eighth is OTHER): the colour follows the position the page
 *  chose, so the same list is the same colours in a donut and in its legend. A slice that has a colour keeps it and does not use up a hue. */
export function withColors<T extends Slice>(slices: readonly T[]): T[] {
  let next = 0;
  return slices.map((s) => (s.color ? s : { ...s, color: seriesColor(next++) }));
}

/** The `max` largest slices, biggest first, and everything after them as ONE "Other" slice (the sum of the rest). Nothing is dropped: the total is the same.
 *  With `max` or fewer slices nothing is folded; a single slice that would be the whole tail stays itself (an "Other" of one is its own name). */
export function foldTail<T extends Slice>(slices: readonly T[], max: number, otherLabel = 'Other', href?: string): Slice[] {
  const ranked = positive(slices).slice().sort((a, b) => b.value - a.value);
  const keep = Math.max(1, Math.floor(max));
  if (ranked.length <= keep + 1) return ranked;                                              // folding one slice into "Other" would only rename it
  const head = ranked.slice(0, keep);
  const rest = ranked.slice(keep);
  return [...head, { key: '__other', label: otherLabel, value: sum(rest.map((r) => r.value)), color: OTHER, ...(href ? { href } : {}) }];
}

/** Whole-number shares of a total that add up to exactly 100 (largest remainder), in the order of `values`; all 0 when the total is 0. A slice that is not 0
 *  never reads "0%": a value under half a percent says 1 only if the rounding gave it one, otherwise the caller prints "<1%" (see shareText). */
export function shares(values: readonly number[]): number[] {
  const clean = values.map((v) => (finite(v) && v > 0 ? v : 0));
  const total = sum(clean);
  if (total === 0) return clean.map(() => 0);
  const exact = clean.map((v) => (v / total) * 100);
  const floors = exact.map((x) => Math.floor(x));
  let left = 100 - sum(floors);
  const order = exact.map((x, i) => ({ i, rest: x - Math.floor(x) })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) { if (left <= 0) break; floors[i] += 1; left -= 1; }
  return floors;
}

/** "42%", "<1%" for a share that is not 0 but rounds to it, "0%" for none. `share` is the whole-number share from shares(), `value` the slice's value. */
export const shareText = (share: number, value: number): string => (value > 0 && share === 0 ? '<1%' : `${share}%`);

export type Direction = 'up' | 'down' | 'flat';

export interface Change {
  latest: number;
  previous: number;
  /** latest - previous */
  change: number;
  direction: Direction;
}

/** The last two recorded points of a series: what the figure is now, what it was, and which way it went. null with fewer than two numbers (a series with one
 *  point has no change, and a missing point is skipped, never read as 0). */
export function changeOf(values: readonly (number | null | undefined)[]): Change | null {
  const real = values.filter(finite);
  if (real.length < 2) return null;
  const latest = real[real.length - 1];
  const previous = real[real.length - 2];
  const change = latest - previous;
  return { latest, previous, change, direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat' };
}

export type DeltaTone = 'good' | 'bad' | 'neutral';

/** A change as a tile says it: its words ("up 6", "down 3", "no change"), its arrow and its tone. `goodWhen` says which way is good for THIS figure (open issues:
 *  down; a score: up); with none, a change is neutral. `unit` is text after the size (' pts'), or [one, many] (`[' point', ' points']`). The tone is never the only signal: the words and the arrow carry the same. */
export function deltaOf(change: Change | null, goodWhen?: 'up' | 'down', unit: string | readonly [string, string] = ''): { text: string; direction: Direction; tone: DeltaTone } | null {
  if (!change) return null;
  const n = Math.abs(Math.round(change.change * 10) / 10);
  const size = `${formatCount(n)}${typeof unit === 'string' ? unit : n === 1 ? unit[0] : unit[1]}`;
  const text = change.direction === 'flat' ? 'No change' : `${change.direction === 'up' ? 'Up' : 'Down'} ${size}`;
  const tone: DeltaTone = change.direction === 'flat' || !goodWhen ? 'neutral' : change.direction === goodWhen ? 'good' : 'bad';
  return { text, direction: change.direction, tone };
}

export interface TrendPointLike { label: string; value: number | null }

/** A trend in words, for a screen reader and the chart's text alternative: "Created: from 3 in Jun to 7 in Oct, up 4." Missing points are skipped. */
export function trendText(name: string, points: readonly TrendPointLike[], unit = ''): string {
  const real = points.filter((p) => finite(p.value)) as { label: string; value: number }[];
  if (real.length === 0) return `${name}: no data.`;
  const first = real[0];
  const last = real[real.length - 1];
  if (real.length === 1) return `${name}: ${formatCount(last.value)}${unit} in ${last.label}.`;
  const diff = last.value - first.value;
  const way = diff === 0 ? 'no change' : `${diff > 0 ? 'up' : 'down'} ${formatCount(Math.abs(diff))}${unit}`;
  return `${name}: from ${formatCount(first.value)}${unit} in ${first.label} to ${formatCount(last.value)}${unit} in ${last.label}, ${way}.`;
}

// ── a sparkline ──────────────────────────────────────────────────────────────

export interface SparkGeometry {
  /** one path per run of recorded points: a missing point breaks the line, it is not drawn as 0 */
  lines: string[];
  /** the last recorded point, for the dot that says "now"; null with no point */
  last: { x: number; y: number } | null;
  /** the closed area under the first run, for a soft fill; '' when there is none */
  area: string;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** The path of `values` in a `width` x `height` box with `pad` px of room all round. The y range is the series' own (a flat series is a line in the middle);
 *  `floor` (default: the series' lowest) lets a share start at 0 so a drop from 90 to 80 does not look like a fall to the floor. With under 2 numbers: no line. */
export function sparkGeometry(values: readonly (number | null | undefined)[], width: number, height: number, pad = 3, floor?: number): SparkGeometry {
  const real = values.filter(finite);
  if (real.length < 2) return { lines: [], last: real.length === 1 ? { x: round1(width / 2), y: round1(height / 2) } : null, area: '' };
  const lo = floor !== undefined ? Math.min(floor, ...real) : Math.min(...real);
  const hi = Math.max(...real);
  const span = hi - lo || 1;
  const n = values.length;
  const x = (i: number): number => round1(pad + (n === 1 ? 0 : (i * (width - 2 * pad)) / (n - 1)));
  const y = (v: number): number => round1(hi === lo ? height / 2 : height - pad - ((v - lo) / span) * (height - 2 * pad));
  const lines: string[] = [];
  let run: string[] = [];
  let lastPoint: { x: number; y: number } | null = null;
  let firstRun: Array<{ x: number; y: number }> = [];
  let inFirst = true;
  values.forEach((v, i) => {
    if (finite(v)) {
      const px = x(i);
      const py = y(v);
      run.push(`${run.length === 0 ? 'M' : 'L'}${px},${py}`);
      lastPoint = { x: px, y: py };
      if (inFirst) firstRun.push({ x: px, y: py });
    } else {
      if (run.length) lines.push(run.join(' '));
      run = [];
      if (firstRun.length) inFirst = false;
    }
  });
  if (run.length) lines.push(run.join(' '));
  const area = firstRun.length >= 2
    ? `M${firstRun[0].x},${height - pad} ${firstRun.map((p) => `L${p.x},${p.y}`).join(' ')} L${firstRun[firstRun.length - 1].x},${height - pad} Z`
    : '';
  return { lines, last: lastPoint, area };
}

// ── a score ring ─────────────────────────────────────────────────────────────

/** The dash of a ring of radius `r` filled to `value` percent (clamped to 0-100): stroke-dasharray `${dash} ${circumference}`. */
export function ringDash(value: number, r: number): { circumference: number; dash: number } {
  const circumference = Math.round(2 * Math.PI * r * 100) / 100;
  const pct = finite(value) ? Math.max(0, Math.min(100, value)) : 0;
  return { circumference, dash: Math.round(((circumference * pct) / 100) * 100) / 100 };
}

// ── a heatmap ────────────────────────────────────────────────────────────────

/** The step (0 = empty, 1..steps-1 darker) of a cell value against the largest value of the grid; a value above 0 is never step 0. */
export function heatStep(value: number | null | undefined, max: number, steps = 5): number {
  if (!finite(value) || value <= 0 || !finite(max) || max <= 0) return 0;
  return Math.max(1, Math.min(steps - 1, Math.ceil((value / max) * (steps - 1))));
}

// ── the text alternative of a chart ──────────────────────────────────────────

/** The table of a list of slices, for a chart that has no visible list of its own. */
export function sliceData(slices: readonly Slice[], firstColumn: string, valueColumn = 'Count'): ChartData {
  const total = sum(slices.map((s) => s.value));
  const pct = shares(slices.map((s) => s.value));
  return { columns: [firstColumn, valueColumn, 'Share'], rows: slices.map((s, i) => [s.label, s.value, total > 0 ? shareText(pct[i], s.value) : null]) };
}
