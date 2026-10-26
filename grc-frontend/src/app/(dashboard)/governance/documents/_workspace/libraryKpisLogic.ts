// The arithmetic behind the library's "Document health" donut and its percentages, without React, so `node --test` checks it
// (libraryKpisLogic.test.ts). The card (LibraryKpis.tsx) only draws what this returns; what each number means lives in libraryModel.ts.
import type { Health, ReviewBucket } from './libraryModel.ts';

/** The order of the donut's segments (clockwise from 12 o'clock) and of the legend's rows: the good news first. */
export const HEALTH_ORDER: ReviewBucket[] = ['ok', 'due_soon', 'overdue', 'unscheduled'];

export const HEALTH_COLOUR: Record<ReviewBucket, string> = {
  ok: '#10b981', due_soon: '#f59e0b', overdue: '#f43f5e', unscheduled: '#cbd5e1',
};

/** How many documents sit in a bucket. */
export function healthCount(h: Health, bucket: ReviewBucket): number {
  switch (bucket) {
    case 'ok': return h.upToDate;
    case 'due_soon': return h.dueSoon;
    case 'overdue': return h.overdue;
    case 'unscheduled': return h.unscheduled;
  }
}

/**
 * A share as a whole number of percent. Rounded, but never to an extreme that is not true: one overdue document among 300 is 1%,
 * not 0%, and 299 up to date out of 300 is 99%, not "100% up to date" over a red segment.
 */
export function percent(part: number, whole: number): number {
  if (!(whole > 0) || !(part > 0)) return 0;
  if (part >= whole) return 100;
  return Math.min(99, Math.max(1, Math.round((part * 100) / whole)));
}

export interface DonutArc {
  bucket: ReviewBucket;
  /** the visible length of the arc (stroke-dasharray, first number) */
  dash: number;
  /** the rest of the circle (stroke-dasharray, second number) */
  gap: number;
  /** stroke-dashoffset: where the arc starts, as a negative length along the circle */
  offset: number;
  colour: string;
}

/** An arc that has documents in it is always at least this long, so one overdue document among hundreds is still a visible sliver. */
const MIN_DASH = 1.5;

/**
 * The segments of the donut, in HEALTH_ORDER, skipping the empty buckets. Each is a `<circle>` of the given radius drawn with
 * `strokeDasharray={`${dash} ${gap}`}` and `strokeDashoffset={offset}`; the svg is rotated -90deg so the first arc starts at 12
 * o'clock. Between two arcs there is a gap of `gapDegrees`, centred on the boundary (a lone arc is a whole ring, with no gap).
 * Arcs the bucket sizes make shorter than the gap keep MIN_DASH, so they overlap their neighbour's gap rather than vanish.
 */
export function donutArcs(h: Health, opts: { radius: number; gapDegrees?: number }): DonutArc[] {
  const live = HEALTH_ORDER.map((bucket) => ({ bucket, count: healthCount(h, bucket) })).filter((s) => s.count > 0);
  const total = live.reduce((n, s) => n + s.count, 0);
  if (!total) return [];
  const circumference = 2 * Math.PI * opts.radius;
  const gapLength = live.length > 1 ? (circumference * Math.max(0, opts.gapDegrees ?? 0)) / 360 : 0;
  let start = 0;
  return live.map(({ bucket, count }) => {
    const share = (circumference * count) / total;
    const dash = Math.min(circumference, Math.max(share - gapLength, MIN_DASH));
    const arc: DonutArc = { bucket, dash, gap: circumference - dash, offset: -(start + gapLength / 2), colour: HEALTH_COLOUR[bucket] };
    start += share;
    return arc;
  });
}
