// The Cyber Security KPIs panel's rules, without React, so `node --test` checks them (kpiModel.test.ts): which of its states it is in (a failed request is
// said, and a panel with no workbook is simply not there, as before), the counts of its three tiles (the old expressions), how a card's trend is drawn
// (the old auto-zoom of the y axis, moved here), and the words that stand in for the trend and for the colour of a card. The KPI list, their live values and
// how a workbook row becomes a KPI (buildKpis) are components/dashboard/kpiShared.tsx's, shared with the KPI Report page and left alone.
import type { Kpi, Point } from '../../../../components/dashboard/kpiShared';
import { formatDate, formatPercent } from '../../../../lib/format.ts';
import type { Load } from './overviewModel.ts';

export const KPI_REPORT_HREF = '/assessments/cs_kpi';

// ── the panel's states ───────────────────────────────────────────────────────
/** What the panel's one query answers: the workbook's rows and the live values; `liveFailed` when only the live values could not be had (the rows still
 *  show, as KPIs that are not measured yet, and the panel says why, instead of "no live feeds matched"). */
export interface KpiData { items: unknown[]; metrics: Record<string, unknown>; liveFailed: boolean }

export type PanelState = { state: 'loading' } | { state: 'error' } | { state: 'absent' } | { state: 'ready'; liveFailed: boolean };

/** loading: a skeleton; error: said, with Retry; absent: the tenant has no KPI workbook, so there is no panel (as before: it returned nothing); else the panel. */
export function panelState(load: Load, data: KpiData | null | undefined): PanelState {
  if (load === 'loading') return { state: 'loading' };
  if (load === 'error') return { state: 'error' };
  if (!data || !Array.isArray(data.items) || data.items.length === 0) return { state: 'absent' };
  return { state: 'ready', liveFailed: !!data.liveFailed };
}

// ── the three tiles and the grid ─────────────────────────────────────────────
export interface KpiCounts { live: number; onTarget: number; below: number; domains: number }

/** The old tiles: how many live KPIs, how many are on target, how many are below it (a KPI with nothing measured is neither), and across how many domains. */
export function kpiCounts(live: readonly Kpi[]): KpiCounts {
  return {
    live: live.length,
    onTarget: live.filter((k) => k.onTarget).length,
    below: live.filter((k) => k.onTarget === false).length,
    domains: new Set(live.map((k) => k.domain)).size,
  };
}

/** The old rule that kept the last row of a three-column grid full: the last card takes the columns the cards before it leave over. */
export function lastCardSpan(index: number, count: number): 1 | 2 | 3 {
  const rem = count % 3;
  return index === count - 1 ? (rem === 1 ? 3 : rem === 2 ? 2 : 1) : 1;
}

export type TargetState = 'on_target' | 'below_target' | 'not_measured';

/** On target, below it, or not measured. The old card said "Below target" for a KPI with nothing measured. */
export const targetState = (k: Pick<Kpi, 'onTarget'>): TargetState => (k.onTarget === true ? 'on_target' : k.onTarget === false ? 'below_target' : 'not_measured');

// ── the trend ────────────────────────────────────────────────────────────────
export interface Reading { date: string; value: number }

/** The readings of a history that have a value, oldest first (a reading is a day written YYYY-MM-DD, which sorts as text; the order the server sends them in is not relied on). */
export const readings = (history: readonly Point[] | null | undefined): Reading[] => (history || [])
  .filter((h): h is Reading => h.value != null)
  .slice()
  .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

const clamp = (v: number | null) => Math.max(0, Math.min(100, v ?? 0));

/** The y scale of a trend: auto-zoomed to the data and the target, so a flat line is not drawn on the floor of the chart (kpiShared's `makeY`, moved: it is not exported there). */
export function scaleY(pts: readonly Reading[], target: number | null, height: number, padTop: number, padBottom: number): (v: number) => number {
  const vals = pts.map((p) => p.value);
  const refs = target != null ? vals.concat(target) : vals;
  let lo = Math.min(...refs);
  let hi = Math.max(...refs);
  const span = hi - lo;
  const pad = Math.max(4, span * 0.18);
  lo = Math.max(0, lo - pad);
  hi = Math.min(100, hi + pad);
  if (hi - lo < 1) hi = lo + 1;
  return (v) => height - padBottom - ((clamp(v) - lo) / (hi - lo)) * (height - padTop - padBottom);
}

export interface Spark {
  /** the polyline's points in a `width` x `height` box */
  points: string;
  /** the y of the target line, null with no target */
  targetY: number | null;
  /** the last reading as a share of the box, for a marker drawn in HTML (an SVG circle in a stretched box is an ellipse) */
  last: { left: number; top: number };
  width: number;
  height: number;
}

/** The trend line of a history (null with fewer than two readings: there is no line to draw, only a point). */
export function spark(history: readonly Point[] | null | undefined, target: number | null, width = 200, height = 48, pad = 4): Spark | null {
  const pts = readings(history);
  const n = pts.length;
  if (n < 2) return null;
  const x = (i: number) => pad + ((width - 2 * pad) * i) / (n - 1);
  const y = scaleY(pts, target, height, pad, pad);
  const lastY = y(pts[n - 1].value);
  return {
    points: pts.map((h, i) => `${x(i).toFixed(1)},${y(h.value).toFixed(1)}`).join(' '),
    targetY: target != null ? y(target) : null,
    last: { left: (x(n - 1) / width) * 100, top: (lastY / height) * 100 },
    width,
    height,
  };
}

/** A day of a reading as the platform writes it ("12 Oct 2026"): a reading is a day, so it never moves with the viewer's time zone. */
export const readingDay = (date: string): string => formatDate(date, { calendar: true });

/** The trend in words, for a screen reader and for the line under the picture. */
export function trendSummary(history: readonly Point[] | null | undefined, target: number | null): string {
  const pts = readings(history);
  const goal = target != null ? ` Target ${formatPercent(target)}.` : '';
  if (pts.length === 0) return 'No readings recorded yet.';
  const last = pts[pts.length - 1];
  if (pts.length === 1) return `One reading: ${formatPercent(last.value)} on ${readingDay(last.date)}.${goal}`;
  const first = pts[0];
  return `${pts.length} readings, from ${formatPercent(first.value)} on ${readingDay(first.date)} to ${formatPercent(last.value)} on ${readingDay(last.date)}.${goal}`;
}

export interface Period { date: string; day: string; value: number; target: number | null; /** actual minus target, in percentage points */ variance: number | null }

/** The latest readings with how far each is from the target (the old "period cards": the last five). */
export function recentPeriods(history: readonly Point[] | null | undefined, target: number | null, count = 5): Period[] {
  return readings(history).slice(-count).map((p) => ({
    date: p.date,
    day: readingDay(p.date),
    value: Math.round(p.value),
    target: target != null ? Math.round(target) : null,
    variance: target != null ? Math.round(p.value - target) : null,
  }));
}

// ── words ────────────────────────────────────────────────────────────────────
/** What "on target" asks of a KPI: actual at or above the target, or at or below it when lower is better. */
export const targetRule = (k: Pick<Kpi, 'lowerBetter'>): string => (k.lowerBetter ? 'Actual at or below the target' : 'Actual at or above the target');

export const directionText = (k: Pick<Kpi, 'lowerBetter'>): string => (k.lowerBetter ? 'Lower is better' : 'Higher is better');

/** A KPI card's accessible name: what it measures, where it stands against its target, and that it opens the detail. */
export function cardLabel(k: Pick<Kpi, 'topic' | 'domain' | 'actual' | 'target' | 'onTarget'>, word: string): string {
  const against = k.target != null ? ` against a target of ${formatPercent(k.target)}` : '';
  return `${k.topic}, ${k.domain}: ${formatPercent(k.actual)}${against}. ${word}. Opens the details.`;
}

/** "54 of 66" for a KPI that has its counts, else ''. */
export function ofText(k: Pick<Kpi, 'numerator' | 'denominator'>): string {
  return k.numerator != null && k.denominator != null ? `${k.numerator} of ${k.denominator}` : '';
}
